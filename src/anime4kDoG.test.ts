// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDoGPipeline, DOG_SHADERS } from './anime4kDoG'

// WebGPU 的这些常量是浏览器全局,jsdom / node 都没有。取真实规范值。
const GPU_TEXTURE_USAGE = {
  COPY_SRC: 1,
  COPY_DST: 2,
  TEXTURE_BINDING: 4,
  STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: 16,
}
const GPU_BUFFER_USAGE = { COPY_DST: 8, UNIFORM: 64 }
const GPU_SHADER_STAGE = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }

type Recorded = {
  textures: { label: string; descriptor: GPUTextureDescriptor; destroyed: boolean }[]
  buffers: { label: string; descriptor: GPUBufferDescriptor; destroyed: boolean }[]
  shaders: { label: string; code: string }[]
  layouts: { label: string; entries: GPUBindGroupLayoutEntry[] }[]
  bindGroups: { label: string; layout: string; entries: GPUBindGroupEntry[] }[]
  pipelines: { label: string; entryPoint: string; shader: string }[]
  writes: { buffer: string; offset: number; data: number[] }[]
}

// 只记录调用,不做任何 GPU 工作。要验的是接线,不是渲染结果。
function fakeDevice() {
  const recorded: Recorded = {
    textures: [],
    buffers: [],
    shaders: [],
    layouts: [],
    bindGroups: [],
    pipelines: [],
    writes: [],
  }
  const view = (label: string) => ({ __view: label }) as unknown as GPUTextureView

  const device = {
    createTexture(descriptor: GPUTextureDescriptor) {
      const label = String(descriptor.label)
      const entry = { label, descriptor, destroyed: false }
      recorded.textures.push(entry)
      return {
        label,
        width: (descriptor.size as number[])[0],
        height: (descriptor.size as number[])[1],
        createView: () => view(label),
        destroy: () => {
          entry.destroyed = true
        },
      } as unknown as GPUTexture
    },
    createBuffer(descriptor: GPUBufferDescriptor) {
      const label = String(descriptor.label)
      const entry = { label, descriptor, destroyed: false }
      recorded.buffers.push(entry)
      return {
        label,
        destroy: () => {
          entry.destroyed = true
        },
      } as unknown as GPUBuffer
    },
    createShaderModule(descriptor: GPUShaderModuleDescriptor) {
      recorded.shaders.push({
        label: String(descriptor.label),
        code: descriptor.code,
      })
      return { __shader: String(descriptor.label) } as unknown as GPUShaderModule
    },
    createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor) {
      const label = String(descriptor.label)
      recorded.layouts.push({
        label,
        entries: [...(descriptor.entries as GPUBindGroupLayoutEntry[])],
      })
      return { __layout: label } as unknown as GPUBindGroupLayout
    },
    createPipelineLayout() {
      return {} as GPUPipelineLayout
    },
    createComputePipeline(descriptor: GPUComputePipelineDescriptor) {
      const label = String(descriptor.label)
      recorded.pipelines.push({
        label,
        entryPoint: String(descriptor.compute.entryPoint),
        shader: (descriptor.compute.module as unknown as { __shader: string }).__shader,
      })
      return { __pipeline: label } as unknown as GPUComputePipeline
    },
    createBindGroup(descriptor: GPUBindGroupDescriptor) {
      recorded.bindGroups.push({
        label: String(descriptor.label),
        layout: (descriptor.layout as unknown as { __layout: string }).__layout,
        entries: [...(descriptor.entries as GPUBindGroupEntry[])],
      })
      return { __bindGroup: String(descriptor.label) } as unknown as GPUBindGroup
    },
    queue: {
      writeBuffer(buffer: GPUBuffer, offset: number, data: BufferSource) {
        recorded.writes.push({
          buffer: (buffer as unknown as { label: string }).label,
          offset,
          data: Array.from(new Float32Array(data as ArrayBufferView['buffer'])),
        })
      },
    },
  } as unknown as GPUDevice

  return { device, recorded }
}

function fakeEncoder() {
  const calls: string[] = []
  const encoder = {
    beginComputePass() {
      calls.push('begin')
      return {
        setPipeline: (pipeline: GPUComputePipeline) =>
          calls.push(`pipeline:${(pipeline as unknown as { __pipeline: string }).__pipeline}`),
        setBindGroup: (index: number, group: GPUBindGroup) =>
          calls.push(
            `bind:${index}:${(group as unknown as { __bindGroup: string }).__bindGroup}`,
          ),
        dispatchWorkgroups: (x: number, y: number) => calls.push(`dispatch:${x}x${y}`),
        end: () => calls.push('end'),
      }
    },
  } as unknown as GPUCommandEncoder
  return { encoder, calls }
}

const makeInput = (width: number, height: number) =>
  ({
    width,
    height,
    createView: () => ({ __view: 'input' }) as unknown as GPUTextureView,
  }) as unknown as GPUTexture

const globals = globalThis as Record<string, unknown>

beforeEach(() => {
  globals.GPUTextureUsage = GPU_TEXTURE_USAGE
  globals.GPUBufferUsage = GPU_BUFFER_USAGE
  globals.GPUShaderStage = GPU_SHADER_STAGE
})

afterEach(() => {
  delete globals.GPUTextureUsage
  delete globals.GPUBufferUsage
  delete globals.GPUShaderStage
})

describe('DoG WGSL 与手写绑定一致', () => {
  // 内联管线最容易错的地方:layout 里写的 binding 和 WGSL 里声明的对不上。
  // WebGPU 会在 createComputePipeline 时报错,但那要真机才触发,这里静态比对。
  const declaredBindings = (code: string) =>
    [...code.matchAll(/@group\(0\)\s+@binding\((\d+)\)/g)]
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b)

  it('每段 shader 的 binding 序号与 layout 完全对应', () => {
    const { device, recorded } = fakeDevice()
    createDoGPipeline({ device, inputTexture: makeInput(64, 32) })

    for (const { label, code } of recorded.shaders) {
      const layout = recorded.layouts.find((l) => l.label === `${label.replace('-shader', '')}-layout`)
      expect(layout, `找不到 ${label} 对应的 layout`).toBeDefined()
      expect(layout!.entries.map((entry) => entry.binding).sort((a, b) => a - b)).toEqual(
        declaredBindings(code),
      )
    }
  })

  it('每段 shader 都以 computeMain 为入口,workgroup 为 8x8', () => {
    for (const [name, code] of Object.entries(DOG_SHADERS)) {
      expect(code, name).toContain('@workgroup_size(8, 8)')
      expect(code, name).toContain('fn computeMain(')
    }
    const { device, recorded } = fakeDevice()
    createDoGPipeline({ device, inputTexture: makeInput(64, 32) })
    expect(recorded.pipelines.map((p) => p.entryPoint)).toEqual([
      'computeMain',
      'computeMain',
      'computeMain',
      'computeMain',
    ])
  })

  it('storage texture 的格式与中间纹理一致', () => {
    const { device, recorded } = fakeDevice()
    createDoGPipeline({ device, inputTexture: makeInput(64, 32) })
    for (const texture of recorded.textures) {
      expect(texture.descriptor.format).toBe('rgba16float')
    }
    for (const layout of recorded.layouts) {
      for (const entry of layout.entries) {
        if (entry.storageTexture) {
          expect(entry.storageTexture.format).toBe('rgba16float')
          expect(entry.storageTexture.access).toBe('write-only')
        }
      }
    }
    // WGSL 里声明的 storage texture 格式必须跟着一起对上。
    for (const code of Object.values(DOG_SHADERS)) {
      expect(code).toContain('texture_storage_2d<rgba16float, write>')
    }
  })
})

describe('DoG 管线接线', () => {
  it('创建 4 张同尺寸中间纹理与 1 个 strength uniform', () => {
    const { device, recorded } = fakeDevice()
    createDoGPipeline({ device, inputTexture: makeInput(1920, 1080) })

    expect(recorded.textures).toHaveLength(4)
    for (const texture of recorded.textures) {
      expect(texture.descriptor.size).toEqual([1920, 1080, 1])
      expect(texture.descriptor.usage).toBe(
        GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.STORAGE_BINDING,
      )
    }
    expect(recorded.buffers).toHaveLength(1)
    expect(recorded.buffers[0].descriptor.size).toBe(4)
    expect(recorded.buffers[0].descriptor.usage).toBe(
      GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    )
  })

  it('四段按 输入→亮度→X→Y→合成 串起来,合成段读亮度图与原始帧', () => {
    const { device, recorded } = fakeDevice()
    const input = makeInput(64, 32)
    createDoGPipeline({ device, inputTexture: input })

    const viewOf = (entry: GPUBindGroupEntry) =>
      (entry.resource as unknown as { __view?: string }).__view ??
      (entry.resource as { buffer: { label: string } }).buffer.label
    const wiring = recorded.bindGroups.map((group) => ({
      label: group.label,
      entries: group.entries.map((entry) => `${entry.binding}:${viewOf(entry)}`),
    }))

    expect(wiring).toEqual([
      {
        label: 'anime4k-dog-luma-bind-group',
        entries: ['0:input', '1:anime4k-dog-luma'],
      },
      {
        label: 'anime4k-dog-x-bind-group',
        entries: ['0:anime4k-dog-luma', '1:anime4k-dog-x'],
      },
      {
        label: 'anime4k-dog-y-bind-group',
        entries: ['0:anime4k-dog-x', '1:anime4k-dog-y'],
      },
      {
        // binding 1 必须是第 1 段的亮度图而不是第 3 段的输出,binding 2 是原始帧。
        label: 'anime4k-dog-apply-bind-group',
        entries: [
          '0:anime4k-dog-y',
          '1:anime4k-dog-luma',
          '2:input',
          '3:anime4k-dog-output',
          '4:anime4k-dog-strength',
        ],
      },
    ])
  })

  it('输出纹理是最后一段写入的那张', () => {
    const { device } = fakeDevice()
    const pipeline = createDoGPipeline({ device, inputTexture: makeInput(64, 32) })
    expect((pipeline.getOutputTexture() as unknown as { label: string }).label).toBe(
      'anime4k-dog-output',
    )
  })

  it('pass 按顺序开 4 个 compute pass,派发数向上取整', () => {
    const { device } = fakeDevice()
    const pipeline = createDoGPipeline({ device, inputTexture: makeInput(1921, 1081) })
    const { encoder, calls } = fakeEncoder()
    pipeline.pass(encoder)

    // 1921/8 = 240.125 → 241;1081/8 = 135.125 → 136。取整错了会漏掉边缘像素。
    expect(calls.filter((call) => call.startsWith('dispatch'))).toEqual([
      'dispatch:241x136',
      'dispatch:241x136',
      'dispatch:241x136',
      'dispatch:241x136',
    ])
    expect(calls.filter((call) => call.startsWith('pipeline'))).toEqual([
      'pipeline:anime4k-dog-luma',
      'pipeline:anime4k-dog-x',
      'pipeline:anime4k-dog-y',
      'pipeline:anime4k-dog-apply',
    ])
    // 每段各自成一个 pass:合并会读到上一段还没写完的数据。
    expect(calls.filter((call) => call === 'begin')).toHaveLength(4)
    expect(calls.filter((call) => call === 'end')).toHaveLength(4)
    expect(calls[0]).toBe('begin')
    expect(calls.at(-1)).toBe('end')
  })
})

describe('DoG strength 参数', () => {
  it('写入 4 字节 float 到 strength buffer 起始处', () => {
    const { device, recorded } = fakeDevice()
    const pipeline = createDoGPipeline({ device, inputTexture: makeInput(64, 32) })
    pipeline.updateParam('strength', 3)
    expect(recorded.writes).toEqual([
      { buffer: 'anime4k-dog-strength', offset: 0, data: [3] },
    ])
  })

  it('拒绝未知参数与非法数值', () => {
    const { device } = fakeDevice()
    const pipeline = createDoGPipeline({ device, inputTexture: makeInput(64, 32) })
    // @ts-expect-error 只接受 'strength'
    expect(() => pipeline.updateParam('sharpness', 1)).toThrow(/未知参数/)
    expect(() => pipeline.updateParam('strength', -1)).toThrow(/非负/)
    expect(() => pipeline.updateParam('strength', Number.NaN)).toThrow(/非负/)
    expect(() => pipeline.updateParam('strength', 0)).not.toThrow()
  })
})

describe('DoG 资源释放', () => {
  it('destroy 释放自己的纹理与 buffer,不碰输入纹理', () => {
    const { device, recorded } = fakeDevice()
    const input = makeInput(64, 32)
    let inputDestroyed = false
    ;(input as unknown as { destroy: () => void }).destroy = () => {
      inputDestroyed = true
    }
    const pipeline = createDoGPipeline({ device, inputTexture: input })
    pipeline.destroy()

    expect(recorded.textures.every((texture) => texture.destroyed)).toBe(true)
    expect(recorded.buffers.every((buffer) => buffer.destroyed)).toBe(true)
    // inputTexture 归调用方管,管线重建时它会被单独 destroy。
    expect(inputDestroyed).toBe(false)
  })
})
