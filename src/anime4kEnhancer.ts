// ============================================================================
// Anime4K WebGPU 画质增强
// ----------------------------------------------------------------------------
// 把 video 帧实时送进 Anime4K(超分 + 修复)管线,渲染到覆盖在视频上方的 canvas。
// 官方包 anime4k-webgpu 内置 3MB+ WGSL shader,这里用动态 import,只有用户
// 手动开启时才加载;渲染循环自己管理(requestVideoFrameCallback),可以随时停止。
// ============================================================================

export type Anime4KHandle = {
  stop: () => void
  // 供调用方注册致命错误回调(设备丢失 / 跨域污染)。
  onFatal: ((error: unknown) => void) | null
}

const HD_PIXELS = 1280 * 720
const FULL_HD_PIXELS = 1920 * 1080

// 越高分辨率的单帧 GPU 成本越高。限制增强帧率不影响 video 解码帧率，
// 只是在两帧增强结果之间保留上一帧，优先保障播放连续性。
export function enhancementTargetFps(width: number, height: number): number {
  const pixels = Math.max(0, width) * Math.max(0, height)
  if (pixels > FULL_HD_PIXELS) return 15
  if (pixels > HD_PIXELS) return 24
  return 30
}

export function isAnime4KSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "gpu" in navigator &&
    typeof GPUCanvasContext !== "undefined"
  )
}

// 全屏三角形 + 采样,把管线输出纹理画到 canvas。
const BLIT_VERT = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn main(@builtin(vertex_index) i: u32) -> VertexOutput {
  const pos = array(
    vec2(1.0, 1.0), vec2(1.0, -1.0), vec2(-1.0, -1.0),
    vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(-1.0, 1.0),
  );
  const uv = array(
    vec2(1.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0),
    vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, 0.0),
  );
  var out: VertexOutput;
  out.position = vec4(pos[i], 0.0, 1.0);
  out.uv = uv[i];
  return out;
}
`

const BLIT_FRAG = /* wgsl */ `
@group(0) @binding(1) var blitSampler: sampler;
@group(0) @binding(2) var blitTexture: texture_2d<f32>;

@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(blitTexture, blitSampler, uv);
}
`

type VideoFrameCallbackHost = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number
  cancelVideoFrameCallback?: (id: number) => void
}

/**
 * 启动增强渲染。失败抛错(不支持 WebGPU / 视频跨域受污染 / 设备丢失),
 * 由调用方决定如何提示。stop() 幂等。
 */
export async function startAnime4K(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<Anime4KHandle> {
  if (!isAnime4KSupported()) throw new Error("当前浏览器不支持 WebGPU")
  if (video.readyState < video.HAVE_FUTURE_DATA) {
    await new Promise<void>((resolve, reject) => {
      const ok = () => {
        cleanup()
        resolve()
      }
      const bad = () => {
        cleanup()
        reject(new Error("视频尚未就绪"))
      }
      const cleanup = () => {
        video.removeEventListener("loadeddata", ok)
        video.removeEventListener("error", bad)
      }
      video.addEventListener("loadeddata", ok)
      video.addEventListener("error", bad)
    })
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  })
  if (!adapter) throw new Error("未找到可用的 WebGPU 适配器")
  const device = await adapter.requestDevice()
  const context = canvas.getContext("webgpu")
  if (!context) throw new Error("无法创建 WebGPU 画布上下文")
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat()
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: "premultiplied",
  })

  // GANUUL 内部有 18 段 compute pipeline，对集成显卡会抢占视频解码所需的
  // GPU 时间。DoG 是 Anime4K 自带的轻量清晰化管线，适合持续在线播放。
  const { DoG } = await import("anime4k-webgpu")

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  })
  const renderPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    }),
    vertex: {
      module: device.createShaderModule({ code: BLIT_VERT }),
      entryPoint: "main",
    },
    fragment: {
      module: device.createShaderModule({ code: BLIT_FRAG }),
      entryPoint: "main",
      targets: [{ format: presentationFormat }],
    },
    primitive: { topology: "triangle-list" },
  })
  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  })

  type Anime4KPipeline = {
    pass: (encoder: GPUCommandEncoder) => void
    getOutputTexture: () => GPUTexture
    textures?: GPUTexture[]
    strengthBuffer?: GPUBuffer
  }
  let texW = 0
  let texH = 0
  let inputTexture: GPUTexture | null = null
  let pipelines: Anime4KPipeline[] = []
  let blitBindGroup: GPUBindGroup | null = null
  let targetFps = 30
  let minFrameInterval = 1000 / targetFps

  const destroyPipelines = () => {
    for (const pipeline of pipelines) {
      pipeline.textures?.forEach((texture) => texture.destroy())
      pipeline.strengthBuffer?.destroy()
    }
    pipelines = []
  }

  // 源分辨率变化(切清晰度 / 换集)时重建管线;原生分辨率修复,不放大。
  const rebuild = () => {
    texW = video.videoWidth
    texH = video.videoHeight
    if (!texW || !texH) throw new Error("视频尺寸未就绪")
    destroyPipelines()
    inputTexture?.destroy()
    inputTexture = device.createTexture({
      size: [texW, texH, 1],
      format: "rgba16float",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
    const deblur = new DoG({ device, inputTexture })
    deblur.updateParam("strength", 3)
    pipelines = [deblur]
    targetFps = enhancementTargetFps(texW, texH)
    minFrameInterval = 1000 / targetFps
    canvas.width = texW
    canvas.height = texH
    canvas.dataset.enhancementProfile = "realtime-dog"
    canvas.dataset.enhancementTargetFps = String(targetFps)
    blitBindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 1, resource: sampler },
        {
          binding: 2,
          resource: pipelines[pipelines.length - 1]
            .getOutputTexture()
            .createView(),
        },
      ],
    })
  }
  rebuild()

  let stopped = false
  const handle: Anime4KHandle = { stop, onFatal: null }
  device.lost.then((info) => {
    if (!stopped && info.reason !== "destroyed")
      handle.onFatal?.(new Error(info.message))
  })

  let lastSubmittedAt = Number.NEGATIVE_INFINITY
  let slowFrameStreak = 0

  const fail = (error: unknown) => {
    if (stopped) return
    stop()
    handle.onFatal?.(error)
  }

  const renderFrame = (now = 0) => {
    if (stopped) return
    if (document.hidden || video.paused || video.ended) {
      schedule()
      return
    }
    if (now - lastSubmittedAt < minFrameInterval) {
      schedule()
      return
    }
    try {
      if (video.videoWidth !== texW || video.videoHeight !== texH) rebuild()
      if (inputTexture) {
        device.queue.copyExternalImageToTexture(
          { source: video },
          { texture: inputTexture },
          [texW, texH],
        )
      }
      const encoder = device.createCommandEncoder()
      for (const pipeline of pipelines) pipeline.pass(encoder)
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      })
      pass.setPipeline(renderPipeline)
      pass.setBindGroup(0, blitBindGroup)
      pass.draw(6)
      pass.end()
      device.queue.submit([encoder.finish()])
      lastSubmittedAt = now
    } catch (error) {
      // 常见失败:视频跨域被污染(SecurityError)。直接停止并通知上层。
      fail(error)
      return
    }

    // 严格只保留一帧 GPU 工作在途。不等待就继续 submit 会令命令队列
    // 无界增长，最终抢占解码与合成资源，表现为画面掉帧和 HLS 卡顿。
    const submittedAt = globalThis.performance?.now?.() ?? Date.now()
    void device.queue.onSubmittedWorkDone().then(
      () => {
        if (stopped) return
        const finishedAt = globalThis.performance?.now?.() ?? Date.now()
        const gpuMs = finishedAt - submittedAt
        slowFrameStreak = gpuMs > 80 ? slowFrameStreak + 1 : Math.max(0, slowFrameStreak - 1)
        if (slowFrameStreak >= 8) {
          fail(new Error("当前设备的 GPU 无法流畅运行画质增强"))
          return
        }
        schedule()
      },
      fail,
    )
  }

  const host = video as VideoFrameCallbackHost
  let rafId = 0
  let vfcId = 0
  // 暂停时 rVFC 不触发,天然省电;无 rVFC 的环境退回 rAF。
  const schedule = () => {
    if (stopped) return
    if (host.requestVideoFrameCallback) {
      vfcId = host.requestVideoFrameCallback(renderFrame)
    } else {
      rafId = requestAnimationFrame(renderFrame)
    }
  }
  schedule()

  function stop() {
    if (stopped) return
    stopped = true
    if (host.cancelVideoFrameCallback) host.cancelVideoFrameCallback(vfcId)
    cancelAnimationFrame(rafId)
    destroyPipelines()
    inputTexture?.destroy()
    device.destroy()
  }

  return handle
}
