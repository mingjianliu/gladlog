/** 分析缓存的版本键:主进程写缓存、读缓存,E2E 播种缓存,三处共用同一常量。
 *
 *  谓词单源 —— 硬编码副本会在版本变更时静默失效:缓存被 getCached 丢弃,
 *  面板停在空闲态,而 E2E 只会看到「没有 finding」这种没有指向性的失败。
 *
 *  v3: candidate menu expanded — deaths tagged friendly/enemy (side fact) and
 *  cd-waste events (never-used defensive cooldowns) added; prompt gained an
 *  event legend and whole-round time display.
 *  v4(D2): 视角改为日志记录者(owner)—— DPS 记录者从治疗视角切到本人视角,
 *  旧缓存(同 matchId 的治疗视角结果)必须失效;DPS owner 菜单新增四类事件
 *  (burst-into-immunity / off-target-in-window / juked-kick / dr-clipped-cc)
 *  与 <burst_ledger> 块。治疗记录者 prompt 字节不变,缓存键随版本一并轮换。
 *  v9: HP/短名;v10: 可教信号门 + owner 锚定 + 干净窗口留白;
 *  v11: 走位信号(第四类);v12: 进攻深挖(非死亡 finding) */
export const PROMPT_VERSION = 12;
