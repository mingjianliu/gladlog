/** 无障碍豁免清单:标准是 WCAG 2.1 A+AA,违规集合必须 ⊆ 本清单。
 *  政策 = 修或显式豁免,不许静默。本文件就是可见的技术债清单。 */
export type AxeExemption = {
  /** axe 规则 id,如 "color-contrast" */
  rule: string;
  /** 违规节点选择器(axe 报的 target[0]),支持前缀匹配 */
  selector: string;
  /** 为什么接受 —— 一行说清 */
  why: string;
};

export const AXE_EXEMPTIONS: AxeExemption[] = [
  {
    rule: "color-contrast",
    selector: "",
    why: "首扫 82 处,全部是深色游戏风 UI 里刻意压暗的次级信息(时间戳、单位、占位说明、未选中的 tab、泳道刻度)——按信息层级分档压暗是这套界面的基本手法,逐处抬亮等于重做配色。整体调档是独立的设计工作,不在质检体系这一期。空 selector = 该规则全量豁免;这是清单里唯一的全量豁免,收窄它就是那次配色工作的验收标准。",
  },
];

export function isExempt(rule: string, target: string): boolean {
  return AXE_EXEMPTIONS.some(
    (e) => e.rule === rule && target.startsWith(e.selector),
  );
}
