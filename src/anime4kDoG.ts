// ============================================================================
// Anime4K DoG(Difference of Gaussians)清晰化管线
// ----------------------------------------------------------------------------
// 内联自 anime4k-webgpu@1.0.0(MIT),只保留本项目实际用到的 DoG 这一条管线。
//
// 原包发布的是 3.45 MB 的 UMD 产物,体积几乎全部来自 GAN 超分的权重常量;
// 播放页只用 DoG,真正需要的就是下面 4 段 WGSL(合计约 5.7 kB)和它们之间的
// 绑定关系。为此拖进近 1 MB gzip 的依赖不划算,故内联。
//
// 4 段 WGSL 逐字照搬上游,未做任何修改 —— 这一刀的目标是体积不是画质,
// 输出必须与原实现完全一致。改动它们等于改画面,不要顺手"优化"。
//
// 上游实现: https://github.com/Anime4KWebBoost/Anime4K-WebGPU (MIT License)
// 原始算法: https://github.com/bloc97/Anime4K (MIT License)
//
// 注意: WebGPU 的全局类型此前是靠 anime4k-webgpu 的 .d.ts 里那句
// /// <reference types="@webgpu/types" /> 间接带进来的。管线内联后依赖没了,
// 类型改由 tsconfig.json 的 compilerOptions.types 显式声明,别再删掉它。
// ============================================================================

// 第 1 段:把 RGB 转成亮度,写进 R 通道。
const LUMINATION_WGSL = /* wgsl */ `
@group(0) @binding(0) var tex_in: texture_2d<f32>;
@group(0) @binding(1) var tex_out: texture_storage_2d<rgba16float, write>;

fn colorAt(x: u32, y: u32) -> vec4f {
  return textureLoad(tex_in, vec2u(x, y), 0);
}

// Function to calculate luminance
fn get_luma(rgba: vec4<f32>) -> f32 {
    return dot(rgba, vec4<f32>(0.299, 0.587, 0.114, 0.0));
}

@compute
@workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) pixel: vec3u) {
  // OOB check
  let dim_in: vec2u = textureDimensions(tex_in);
  let dim_out: vec2u = textureDimensions(tex_out);
  if (pixel.x >= dim_out.x || pixel.y >= dim_out.y) {
    return;
  }

  var color: vec4f = colorAt(pixel.x, pixel.y);
  textureStore(tex_out, vec2u(pixel.x, pixel.y), vec4f(get_luma(color), 0, 0, 1));
}
`

// 第 2 段:沿 X 方向做 7 抽头高斯模糊,同时记录 3 邻域的 min/max。
const DOG_X_WGSL = /* wgsl */ `
@group(0) @binding(0) var tex_in: texture_2d<f32>;
@group(0) @binding(1) var tex_out: texture_storage_2d<rgba16float, write>;

fn colorAt(x: u32, y: u32) -> vec4f {
  return textureLoad(tex_in, vec2u(x, y), 0);
}

fn max3v(a: f32, b: f32, c: f32) -> f32 {
    return max(max(a, b), c);
}

fn min3v(a: f32, b: f32, c: f32) -> f32 {
    return min(min(a, b), c);
}

fn minmax3(pos: vec2u) -> vec2<f32> {
    let a: f32 = colorAt(pos.x - 1, pos.y).x;
    let b: f32 = colorAt(pos.x, pos.y).x;
    let c: f32 = colorAt(pos.x + 1, pos.y).x;
    
    return vec2<f32>(min3v(a, b, c), max3v(a, b, c));
}

fn lumGaussian7(pos: vec2u) -> f32 {
    var g: f32 = (colorAt(pos.x - 2, pos.y).x + colorAt(pos.x + 2, pos.y).x) * 0.06136;
    g += (colorAt(pos.x - 1, pos.y).x + colorAt(pos.x + 1, pos.y).x) * 0.24477;
    g += colorAt(pos.x, pos.y).x * 0.38774;
    
    return g;
}

@compute
@workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) pixel: vec3u) {
  // OOB check
  let dim_in: vec2u = textureDimensions(tex_in);
  let dim_out: vec2u = textureDimensions(tex_out);
  if (pixel.x >= dim_out.x || pixel.y >= dim_out.y) {
    return;
  }
    
  let pos: vec2u = vec2u(pixel.x, pixel.y);

  // Call lumGaussian7 and minmax3_x
  let lum: f32 = lumGaussian7(pos); // directional vector vec2<f32>(1.0, 0.0). Adjust the directional vector as needed based on your texture coordinates and requirements.
  let minmax: vec2<f32> = minmax3(pos); // directional vector vec2<f32>(1.0, 0.0). Adjust the directional vector as needed based on your texture coordinates and requirements.

  // Store the result
  textureStore(tex_out, vec2u(pixel.x, pixel.y), vec4<f32>(lum, minmax, 1.0));
}
`

// 第 3 段:沿 Y 方向重复一次,得到二维可分离高斯与 min/max 包络。
const DOG_Y_WGSL = /* wgsl */ `
@group(0) @binding(0) var tex_in: texture_2d<f32>;
@group(0) @binding(1) var tex_out: texture_storage_2d<rgba16float, write>;

fn colorAt(x: u32, y: u32) -> vec4f {
  return textureLoad(tex_in, vec2u(x, y), 0);
}

fn max3v(a: f32, b: f32, c: f32) -> f32 {
    return max(max(a, b), c);
}

fn min3v(a: f32, b: f32, c: f32) -> f32 {
    return min(min(a, b), c);
}

fn minmax3(pos: vec2u) -> vec2<f32> {
    let a0: f32 = colorAt(pos.x, pos.y - 1).y;
    let b0: f32 = colorAt(pos.x, pos.y).y;
    let c0: f32 = colorAt(pos.x, pos.y + 1).y;

    let a1: f32 = colorAt(pos.x, pos.y - 1).z;
    let b1: f32 = colorAt(pos.x, pos.y).z;
    let c1: f32 = colorAt(pos.x, pos.y + 1).z;
    
    return vec2<f32>(min3v(a0, b0, c0), max3v(a1, b1, c1));
}

fn lumGaussian7(pos: vec2u) -> f32 {
    var g: f32 = (colorAt(pos.x, pos.y - 2).x + colorAt(pos.x, pos.y + 2).x) * 0.06136;
    g += (colorAt(pos.x, pos.y - 1).x + colorAt(pos.x, pos.y + 1).x) * 0.24477;
    g += colorAt(pos.x, pos.y).x * 0.38774;
    
    return g;
}

@compute
@workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) pixel: vec3u) {
  // OOB check
  let dim_in: vec2u = textureDimensions(tex_in);
  let dim_out: vec2u = textureDimensions(tex_out);
  if (pixel.x >= dim_out.x || pixel.y >= dim_out.y) {
    return;
  }
    
  //var color: vec4f = colorAt(pixel.x, pixel.y);
  //textureStore(tex_out, vec2u(pixel.x, pixel.y), vec4f(get_luma(color), 0, 0, 1));

  let pos: vec2u = vec2u(pixel.x, pixel.y);

  // Call lumGaussian7 and minmax3_y
  let lum: f32 = lumGaussian7(pos);
  let minmax: vec2<f32> = minmax3(pos);

// Store the result
  textureStore(tex_out, vec2u(pixel.x, pixel.y), vec4<f32>(lum, minmax, 1.0));
}
`

// 第 4 段:用亮度与模糊结果之差做非线性锐化,并夹在 min/max 之间防振铃,
// 最后叠回原始帧。strength 由 uniform 传入。
const DOG_APPLY_WGSL = /* wgsl */ `
@group(0) @binding(0) var tex_in: texture_2d<f32>; // Kernel-Y output
@group(0) @binding(1) var tex_lum: texture_2d<f32>; // lumination texture
@group(0) @binding(2) var tex_original: texture_2d<f32>;
@group(0) @binding(3) var tex_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> strength: f32;

fn lumAt(x: u32, y: u32) -> vec4f { // read from lumination texture
  return textureLoad(tex_lum, vec2u(x, y), 0);
}

fn colorAt(x: u32, y: u32) -> vec4f { // read from Kernel-Y output texture
  return textureLoad(tex_in, vec2u(x, y), 0);
}


@compute
@workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) pixel: vec3u) {
  // OOB check
  let dim_in: vec2u = textureDimensions(tex_in);
  let dim_out: vec2u = textureDimensions(tex_out);
  if (pixel.x >= dim_out.x || pixel.y >= dim_out.y) {
    return;
  }
  let pos: vec2u = vec2u(pixel.x, pixel.y);


  let BLUR_CURVE: f32 = strength;
  let BLUR_THRESHOLD: f32 = 0.1;
  let NOISE_THRESHOLD: f32 = 0.001;

  let luma: vec4f = lumAt(pos.x, pos.y);
  let color: vec4f = colorAt(pos.x, pos.y);

  let c: f32 = (luma.x - color.x) * strength;

  let t_range: f32 = BLUR_THRESHOLD - NOISE_THRESHOLD;

  var c_t: f32 = abs(c);

  if (c_t > NOISE_THRESHOLD) {
    c_t = (c_t - NOISE_THRESHOLD) / t_range;
    c_t = pow(c_t, BLUR_CURVE);
    c_t = c_t * t_range + NOISE_THRESHOLD;
    c_t = c_t * sign(c);
  } else {
    c_t = c;
  }

  let cc: f32 = clamp(c_t + luma.x, color.y, color.z) - luma.x;

  textureStore(tex_out, vec2u(pixel.x, pixel.y), cc + textureLoad(tex_original, vec2u(pos.x, pos.y), 0));
}
`

const WORKGROUP_SIZE = 8
const INTERMEDIATE_FORMAT: GPUTextureFormat = 'rgba16float'

export type DoGPipeline = {
  /** 把 4 段 compute pass 写进 encoder。 */
  pass: (encoder: GPUCommandEncoder) => void
  /** 最终输出纹理,供上层 blit 到 canvas。 */
  getOutputTexture: () => GPUTexture
  /** 目前只有 strength 一个可调参数,语义与上游一致。 */
  updateParam: (param: 'strength', value: number) => void
  /** 释放本管线自己创建的纹理与 buffer,不碰 inputTexture。 */
  destroy: () => void
}

type Stage = { pipeline: GPUComputePipeline; bindGroup: GPUBindGroup }

const readTexture = (binding: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: GPUShaderStage.COMPUTE,
  texture: {},
})

const writeTexture = (binding: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: GPUShaderStage.COMPUTE,
  storageTexture: { access: 'write-only', format: INTERMEDIATE_FORMAT },
})

export function createDoGPipeline({
  device,
  inputTexture,
}: {
  device: GPUDevice
  inputTexture: GPUTexture
}): DoGPipeline {
  const width = inputTexture.width
  const height = inputTexture.height

  const intermediate = (label: string) =>
    device.createTexture({
      label,
      size: [width, height, 1],
      format: INTERMEDIATE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })

  const lumaTexture = intermediate('anime4k-dog-luma')
  const dogXTexture = intermediate('anime4k-dog-x')
  const dogYTexture = intermediate('anime4k-dog-y')
  const outputTexture = intermediate('anime4k-dog-output')

  const strengthBuffer = device.createBuffer({
    label: 'anime4k-dog-strength',
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const createStage = (
    label: string,
    code: string,
    layoutEntries: GPUBindGroupLayoutEntry[],
    bindEntries: GPUBindGroupEntry[],
  ): Stage => {
    const bindGroupLayout = device.createBindGroupLayout({
      label: `${label}-layout`,
      entries: layoutEntries,
    })
    return {
      pipeline: device.createComputePipeline({
        label,
        layout: device.createPipelineLayout({
          label: `${label}-pipeline-layout`,
          bindGroupLayouts: [bindGroupLayout],
        }),
        compute: {
          module: device.createShaderModule({ label: `${label}-shader`, code }),
          entryPoint: 'computeMain',
        },
      }),
      bindGroup: device.createBindGroup({
        label: `${label}-bind-group`,
        layout: bindGroupLayout,
        entries: bindEntries,
      }),
    }
  }

  // 前三段结构相同:读一张纹理,写一张纹理。
  const stages: Stage[] = [
    createStage(
      'anime4k-dog-luma',
      LUMINATION_WGSL,
      [readTexture(0), writeTexture(1)],
      [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: lumaTexture.createView() },
      ],
    ),
    createStage(
      'anime4k-dog-x',
      DOG_X_WGSL,
      [readTexture(0), writeTexture(1)],
      [
        { binding: 0, resource: lumaTexture.createView() },
        { binding: 1, resource: dogXTexture.createView() },
      ],
    ),
    createStage(
      'anime4k-dog-y',
      DOG_Y_WGSL,
      [readTexture(0), writeTexture(1)],
      [
        { binding: 0, resource: dogXTexture.createView() },
        { binding: 1, resource: dogYTexture.createView() },
      ],
    ),
    // 最后一段要同时读 DoG-Y 结果、亮度图和原始帧,外加 strength uniform。
    // binding 1 是第 1 段的输出(亮度),不是第 3 段的 —— 顺序容易看错。
    createStage(
      'anime4k-dog-apply',
      DOG_APPLY_WGSL,
      [
        readTexture(0),
        readTexture(1),
        readTexture(2),
        writeTexture(3),
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
      [
        { binding: 0, resource: dogYTexture.createView() },
        { binding: 1, resource: lumaTexture.createView() },
        { binding: 2, resource: inputTexture.createView() },
        { binding: 3, resource: outputTexture.createView() },
        { binding: 4, resource: { buffer: strengthBuffer } },
      ],
    ),
  ]

  const workgroupsX = Math.ceil(width / WORKGROUP_SIZE)
  const workgroupsY = Math.ceil(height / WORKGROUP_SIZE)

  return {
    getOutputTexture: () => outputTexture,

    updateParam: (param, value) => {
      if (param !== 'strength') throw new Error(`未知参数: ${param}`)
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`strength 必须是非负有限数,收到 ${value}`)
      }
      device.queue.writeBuffer(strengthBuffer, 0, new Float32Array([value]))
    },

    // 每段单开一个 compute pass:后一段要读前一段写的 storage texture,
    // 靠 pass 边界拿到写后读的可见性保证,合并成一个 pass 会读到旧数据。
    pass: (encoder) => {
      for (const stage of stages) {
        const compute = encoder.beginComputePass()
        compute.setPipeline(stage.pipeline)
        compute.setBindGroup(0, stage.bindGroup)
        compute.dispatchWorkgroups(workgroupsX, workgroupsY)
        compute.end()
      }
    },

    destroy: () => {
      for (const texture of [
        lumaTexture,
        dogXTexture,
        dogYTexture,
        outputTexture,
      ]) {
        texture.destroy()
      }
      strengthBuffer.destroy()
    },
  }
}

// 测试用:校验手写的 bind group layout 与 WGSL 里声明的 binding 一致。
export const DOG_SHADERS = {
  luma: LUMINATION_WGSL,
  x: DOG_X_WGSL,
  y: DOG_Y_WGSL,
  apply: DOG_APPLY_WGSL,
} as const
