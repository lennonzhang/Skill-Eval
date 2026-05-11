---
description: Every 30 minutes, commit workspace changes after two unchanged snapshots
---

Schedule a recurring 30-minute workspace-stability check with `/loop`.

Run this exact recurring task:

```
/loop 30m 检查当前工作区是否有变化（不是和 git 基准比较）。每次先生成“当前工作区快照”：对仓库内所有 tracked + untracked 且未被 gitignore 忽略的文件，排除 .git，按路径排序后基于文件路径和内容 hash 得到一个 workspace snapshot digest。把本次 digest 与上一次检查记录的 digest 比较：相同则连续无变化次数 +1，不同则把连续无变化次数重置为 0 并记录新的 digest。若连续两次都与上一次检查相比无变化，则再检查 git 工作区是否有可提交修改；若有可提交修改，先查看 `git status`、`git diff`（含 staged/unstaged）和最近提交信息，排除明显敏感文件后，按仓库风格创建一个新提交，提交信息包含 `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`；若没有可提交修改，则不要创建空提交，只报告没有可提交内容。不要 push。
```

After scheduling, immediately run the first check as the baseline. For the snapshot command, prefer Git plumbing over comparing against Git state: enumerate `git ls-files -co --exclude-standard`, hash file contents plus paths, sort deterministically, and compare that digest only to the previous run's digest stored in conversation/session state.
