/** 确定性合成战斗日志:E2E 导入链路与性能预算的共同载荷。
 *  无真实玩家数据,可按 eventsPerRound 放大体积,同参数逐字节可复现。 */
export function synthArenaLog(opts?: {
  /** 事件条数,体积由它放大;三处消费方都只需要一场比赛,不需要多轮。 */
  eventsPerRound?: number;
  startMs?: number;
}): string {
  const eventsPerRound = opts?.eventsPerRound ?? 200;
  const startMs = opts?.startMs ?? Date.UTC(2026, 6, 19, 12, 0, 0);

  const players = [
    { guid: "Player-1-0001", name: "Alpha-Realm", flags: "0x511", team: 0 },
    { guid: "Player-1-0002", name: "Bravo-Realm", flags: "0x511", team: 0 },
    { guid: "Player-1-0003", name: "Charlie-Realm", flags: "0x511", team: 0 },
    { guid: "Player-1-0004", name: "Delta-Realm", flags: "0x548", team: 1 },
    { guid: "Player-1-0005", name: "Echo-Realm", flags: "0x548", team: 1 },
    { guid: "Player-1-0006", name: "Foxtrot-Realm", flags: "0x548", team: 1 },
  ];

  const ts = (offsetMs: number): string => {
    const d = new Date(startMs + offsetMs);
    const p2 = (n: number) => String(n).padStart(2, "0");
    const p3 = (n: number) => String(n).padStart(3, "0");
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${p2(
      d.getUTCHours(),
    )}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${p3(
      d.getUTCMilliseconds(),
    )}`;
  };

  const lines: string[] = [];
  const push = (offsetMs: number, body: string) =>
    lines.push(`${ts(offsetMs)}  ${body}`);

  push(0, "ARENA_MATCH_START,1505,41,3v3,1");

  // 每名玩家一条 COMBATANT_INFO(职责:让 l3 认出阵容/专精)
  players.forEach((p, i) => {
    // guid, teamId, 22个0, specId, talents[], pvpTalents(), equipment[], interestingAuras[], rating0, rating1
    push(
      10,
      `COMBATANT_INFO,${p.guid},${p.team},0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,${
        70 + i
      },[],(),[],[],0,0`,
    );
  });

  // 主体事件:攻击方轮转打对面,治疗方回自己人;位置随事件推进
  for (let i = 0; i < eventsPerRound; i++) {
    const t = 1000 + i * 100;
    const src = players[i % 6]!;
    const dst = players[(i + 3) % 6]!;
    const x = (1000 + (i % 50)).toFixed(2);
    const y = (-2000 - (i % 50)).toFixed(2);
    // advanced 参数尾巴:actorGuid, ownerGuid, hp, maxHp, 10个0/或其他, x, y, mapId, facing, unk
    // 必须有 19 个参数, 且 x 和 y 的位置需要被 findXIdx 正确识别 (前 14 个之后寻找含 dot 的项)
    const advanced = `${src.guid},0000000000000000,100000,100000,0,0,0,0,0,0,0,0,0,0,${x},${y},0,1.0,0`;

    if (i % 3 === 2) {
      push(
        t,
        `SPELL_HEAL,${src.guid},"${src.name}",${src.flags},0x0,${src.guid},"${src.name}",${src.flags},0x0,2061,"Flash Heal",0x2,${advanced},4500,4500,0,0,0`,
      );
    } else {
      push(
        t,
        `SPELL_DAMAGE,${src.guid},"${src.name}",${src.flags},0x0,${dst.guid},"${dst.name}",${dst.flags},0x0,133,"Fireball",0x4,${advanced},3200,3200,0,4,0,0,0,0,nil,nil,nil`,
      );
    }
  }

  const victim = players[5]!;
  const endT = 1000 + eventsPerRound * 100 + 500;
  push(
    endT,
    `UNIT_DIED,0000000000000000,nil,0x0,0x0,${victim.guid},"${victim.name}",${victim.flags},0x0,0`,
  );
  push(endT + 500, "ARENA_MATCH_END,0,30,1500,1501");

  return lines.join("\n") + "\n";
}
