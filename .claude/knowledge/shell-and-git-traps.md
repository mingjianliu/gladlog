# shell、git、worktree 与子代理的坑

都是真踩过、读码看不出来的。仓库 skill `.claude/skills/parallel-sessions` 有同类硬纪律,派子代理 / 进 worktree 前先读它。

## 输出与退出码

- 长命令(全语料扫描、presubmit、批量脚本)**不要** `cmd | tail -30`:管道把输出全缓冲,零可观测性;zsh 里 `cmd | tail` 的退出码是 tail 的。写成 `cmd > run.log 2>&1; echo "EXIT=$?"`。门禁命令永远裸跑(presubmit 接管道吞过退出码,CI 红了三个 commit 才发现)。
- `grep -c` 计数为 0 时退出码 1,会咬断 `&&` 链。
- 检查与提交 / 推送 / rebase --continue 之间只用 `&&`;用 `;` 时前一步失败后一步照跑。continue 前 `grep -c '<<<<<<<'` 必须为 0。

## cwd

Bash 工具的 cwd 跨调用持久:一次 `cd packages/eval` 之后 `eslint .` 只扫子包(lint 必须在仓库根)。依赖 cwd 的命令前 `cd <dir> || exit 1`。

## zsh 语义

- zsh 不按空格拆变量:`A="node x.mjs"; $A` 会 127;`FILES="a b"; for f in $FILES` 只循环一次。命令存数组 `"${Q[@]}"`(一个闸门脚本因此每次读空、从未生效)。
- glob 不在赋值或未加引号的变量里展开。
- 命令替换在子 shell:`$(jobs -r | wc -l)` 永远 0 → 并发上限失效(一次起了 59 个 `claude -p`)。并发一律 `xargs -P N`。
- 给 python 传多行脚本用带引号的 heredoc(`<<'EOF'`)或写成文件。
- macOS 没有 `timeout`;`perl -e "alarm N; exec …"` 只杀外层,子进程变孤儿——读结果先数产物是否齐。
- `pgrep -f '<字符串>'` 会匹配到自己的等待命令。

## 编辑工具

Edit / Write 改仓库文件可能触发 prettier 钩子重排整文件(md 表格整张重排、ts 引号全换)。共享大文件改完 `git show --stat` 核对每个文件只动了预期行数;`eslint --fix` 也会顺手重排 import。

## 共享 checkout

1. **`git stash` 是全仓栈**:会收走别人的未提交改动。前后对照永远不用 stash——用私有 worktree 只换一个文件,或逐文件 cp 备份 + `trap` 拷回。
2. **`git add -A` / `commit -a` 会把别人的在制品提交掉**(一次把别的会话含真实角色名的探针推上了公共 main)。永远显式列路径;提交前 `git status --short` 过目。
3. **前后测量被污染**:两次采集之间别人改了树。数字莫名漂移时,第一步 `git log` + `git status` 查是否有并行会话在动;提交信息写明哪些 delta 不是自己的。
4. **push 被拒**:`git worktree add <tmp> origin/main && git cherry-pick <sha> && git push origin HEAD:main`,回来 `git rebase --autostash origin/main`。共享树里永远不要直接动 `refs/heads/main`。
5. **cherry-pick / rebase 冲突别整文件 `--theirs`**:旧基的整份文件会无声冲掉别人这期间的修改。逐行解决;叠完 `git diff <main>..HEAD -- <共享文件>` 只应出现自己的行。高风险共享文件:`buildFindingsPrompt.ts`、`promptVersion.ts`、`candidateFindings.ts`、`docs/predicate-index*.md`、`predicateIndex.test.ts`、`curatedIdRegistry.ts`。
6. **删 worktree 前查有没有会话的 cwd 在里面**:merged + clean 不够。

## worktree

- **先 `npm install`**:没有自己的 node_modules 时解析会爬到主 checkout,`@gladlog/*` 符号链接指向主 checkout 当前分支的源码 → typecheck 假红、A/B 对照臂其实跑的是 main 代码。vitest 能过不代表解析对(vite alias 直指 src,tsc 走 node_modules)。
- 本地 presubmit 可能因仓库里别的 `.worktrees/` 红(lint + doc-commands 扫到它们)。

## 子代理

- **子代理会跑错 checkout**:它的 cwd 是会话启动目录,不是 `EnterWorktree` 之后的目录。派发提示放硬检查:头两条命令 `pwd` + `git -C <worktree> rev-parse --abbrev-ref HEAD`;写明主 checkout 不许动;所有 git 用 `git -C <worktree>`;报 DONE 前 `git -C <worktree> log --oneline -1` 自证。
- **长命令**:Bash 默认 120 s 超时会转后台,子代理随即停住等通知。派发写明「每个 Bash 调用显式传 timeout,前台分批」;重派前 `ps aux | grep <脚本名>` 查游离进程。
- 深挖代理并行共用 scratchpad 会互相覆盖脚本 → 每个代理独立子目录。
- 测 skill 时子代理会读 memory 和仓库里已落地的修复,「无 skill 基线」常不是干净对照。

## 整机负载

- **flaky 测试永远不要用「制造整机负载」来复现**:一次为复现 CI 饱和起了 CPU 死循环 + 并发全量 vitest,load avg 冲到 248,机器卡死。复现不了就写「未能本机复现」+ 按机理改,让用户决定。
- 任何起后台负载的脚本必须 `trap` 清子进程,总进程数不超过 CPU 数;全库扫描在多会话之间也要**全局串行**。
- 「打开软件卡电脑」的表象可能与 app 无关:一次整机冻死其实是几十个孤儿 node 扫描进程(每个约 3 GB)叠加。先查 jetsam 报告 / 孤儿进程(PPID=1),别去 app 里找不存在的泄漏。
- 杀进程只按 PID / 本会话路径,别 `pkill -f presubmit`(会误杀别的会话)。

相关:[batch-fix-workflow.md](batch-fix-workflow.md)、[test-build-ci.md](test-build-ci.md)
