# M1 验收报告:L1 行解析器 SNR 扫荡

日期:2026-07-10。验收标准(spec,经 agy 辩论修正):非空行类型化解码成功率 ≥ 99.9%,未知事件率单独报告,零解析失败有明细。

## 结果

| 语料 | 文件 | 非空行 | typedOk | genericOk(known:false) | failed | 达标 |
| --- | --- | --- | --- | --- | --- | --- |
| playstyle-cache (12GB) | 1,050 | 43,876,240 | 41,945,334 | 1,930,906 | **0** | ✅ 100% |
| benchmarks (92GB) | 5,160 | 342,370,913 | 325,336,755 | 17,034,158 | **0** | ✅ 100% |

**合计 3.86 亿非空行,解析失败 0 行**(typed+generic = 100%,远超 99.9% 线)。

## 未知事件族 top(92GB,占 generic 通道 5.0%)

| 事件 | 行数 |
| SPELL_PERIODIC_MISSED | 6,468,556 |
| DAMAGE_SPLIT | 4,692,595 |
| SPELL_HEAL_ABSORBED | 3,334,370 |
| SWING_MISSED | 1,363,549 |
| SPELL_PERIODIC_ENERGIZE | 811,891 |
| SPELL_PERIODIC_DAMAGE_SUPPORT | 204,399 |
| SPELL_ABSORBED_SUPPORT | 68,848 |
| SWING_DAMAGE_LANDED_SUPPORT | 36,806 |

下游消费面审计确认这些事件族零引用(_MISSED/_ENERGIZE/DAMAGE_SPLIT/_SUPPORT),generic 处理为正确设计;M3 构建器如需可按族补类型化 decoder。

## 过程中发现并修复的真实格式变体(测试样本未覆盖、扫荡抓到)

1. 时间戳显式 UTC 偏移后缀(`23:54:08.392-4`,3 位毫秒+偏移小时,可小数)。
2. 秒小数段宽度可变(3-6 位,按秒小数解释)。
3. COMBATANT_INFO 天赋数组前导空元素 `[,(…)…]`(差分阶段抓到,同属 L1)。
4. 2024 年代 CI 布局(天赋扁平元组、无 auras 段)→ 段落锚定解码。

工具:`packages/parser/scripts/snrSweep.ts`;原始统计 JSON 见本地 /tmp(数字如上,已核录)。
