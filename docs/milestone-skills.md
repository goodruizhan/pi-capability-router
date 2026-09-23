# Skills 里程碑

Router 从 Pi 在 `before_agent_start` 提供的已发现 Skill 元数据建立本地索引，不自行解析或改写 Skill 规范。`capability.search` 返回简短描述与 `skill:<name>` ID；`capability.load` 只读取该 Skill 的 `SKILL.md`，默认最多 8000 字符，后续 references 由模型按需读取。重复加载不会重复注入。

默认 `skills.mode: "safe"` 保留 Pi 原生 Skill 目录提示。设置 `skills.mode: "strict"` 后，Router 在该事件中清空模型提示的 Skill 列表，但保留本地索引；已安装 Skill 文件本身不变。严格模式依赖当前 Pi 的可修改 `systemPromptOptions.skills` 接口，已在本机 `@earendil-works/pi-coding-agent` 0.87.1 的类型与模拟生命周期测试中核对。

验收：搜索指定 Skill，加载后得到带来源路径的正文；重复加载显示已加载；新会话清空加载状态。严格模式下测试确认 Pi Skill 列表从提示选项中移除，且同一 Skill 仍可搜索与加载。`/capability stats` 报告索引数量、正文字符及观察到的目录字符估算。
