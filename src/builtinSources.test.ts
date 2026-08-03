import { describe, expect, it } from "vitest"
import { BUILTIN_LINES, BUILTIN_TVBOX_SOURCES } from "./builtinSources"
import { DEFAULT_SOURCE_ID } from "./data"

describe("preferred built-in sources", () => {
  it("keeps the newly added source group at the start of the list", () => {
    expect(BUILTIN_LINES.slice(0, 5).map((line) => line.name)).toEqual([
      "百度资源 (bdzy.tv)",
      "索尼 (suonizy)",
      "虎牙 (huyazy)",
      "爱奇艺 (iqiyi)",
      "速播 (subozy)",
    ])
  })

  it("selects 速播 as the default built-in source", () => {
    expect(DEFAULT_SOURCE_ID).toBe(
      "tvbox-https://www.subozy.com/api.php/provide/vod",
    )
    expect(
      BUILTIN_TVBOX_SOURCES.find((source) => source.id === DEFAULT_SOURCE_ID)
        ?.name,
    ).toBe("速播 (subozy)")
  })
})
