# 开源来源与许可边界

## 规则与中文记谱

- 项目：WildWriter/ChineseChess-with-deepseek
- 固定提交：`96ec030c4f502bcf96b3234f918b3405fbd73199`
- 来源：https://github.com/WildWriter/ChineseChess-with-deepseek
- 复用文件：`src/xiangqi.js`、`src/xiangqi-notation.js`，保存于 `public/vendor/`，以及 `tests/xiangqi.test.js`，保存为 `tests/upstream-xiangqi.test.js`。
- MIT 原文保留于 `public/vendor/LICENSE-ChineseChess.txt`。
- 规则与记谱文件未修改；`src/xiangqi.js` 是为上游测试提供的重导出入口。

## Pikafish 引擎

- 官方项目：https://github.com/official-pikafish/Pikafish
- 引擎版本：Pikafish-2026-09-06；上游记录的源码提交 `4c17cee11f888ae1d48a9494f2e2239f019f0a1f`。
- 本地 Windows 二进制从上述固定提交复用，未修改。GPLv3 原文为 `engine/Pikafish-GPL-3.0.txt`。
- 同版本对应源码随附于 `engine/source/Pikafish-2026-09-06-source.zip`，说明见该目录 README。
- 外部独立进程通过 UCI 通信，不将引擎代码合并进网页规则模块。
- 再分发引擎时，应保留许可、对应源码及相关通知，不得只提供可执行文件。

## 神经网络权重

- 权重与二进制一起从固定提交取得；分卷与完整性检查见 `scripts/prepare-engine.js`。
- 权重采用其随附的独立许可 `engine/NNUE-License.md`，并非 MIT。该许可限制未经许可的商业使用，禁止违法使用。
- 本项目当前用于非商业课程教学演示。若将来商业化，须重新评估权重授权，不能因主项目为 MIT 就默认获得权重商业许可。

## 本项目新增内容

网页交互、训练目标判定、多解接受、分级提示、知识条目、结构化模型输出校验、对照评测流程、轻量服务端与教学局面由本项目新增。预置局面为自编教学局面，不标称真实对局、教材摘录或用户调研结果。
