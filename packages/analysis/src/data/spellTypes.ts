/**
 * 法术标签枚举(本仓库原创定义)。
 * 旧代码经由 parser 包导入同名枚举;成员名是自有 utils 的互操作事实,
 * 此处独立声明,不引用任何上游表达。
 */
export enum SpellTag {
  Offensive = "Offensive",
  Defensive = "Defensive",
  Control = "Control",
  External = "External",
}
