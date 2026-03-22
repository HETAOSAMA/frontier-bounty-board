const MIST_PER_SUI = 1_000_000_000n;

export function formatMistToSui(mist: bigint): string {
  const sign = mist < 0n ? "-" : "";
  const abs = mist < 0n ? -mist : mist;
  const whole = abs / MIST_PER_SUI;
  const frac = abs % MIST_PER_SUI;
  if (frac === 0n) return `${sign}${whole.toString()}`;

  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${fracStr}`;
}

export function parseSuiToMist(raw: string):
  | { ok: true; value: bigint }
  | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "请输入赏金金额（单位 SUI，例如 0.1）" };

  if (!/^(?:\d+\.\d*|\d*\.\d+|\d+)$/.test(trimmed)) {
    return { ok: false, error: "金额格式不正确（示例：0.1 / 1 / 1.25）" };
  }

  const [rawWhole, rawFrac = ""] = trimmed.split(".");
  const wholeStr = rawWhole === "" ? "0" : rawWhole;
  const fracStr = rawFrac;

  if (fracStr.length > 9) {
    return { ok: false, error: "最多支持 9 位小数（SUI 精度到 1e-9）" };
  }

  try {
    const whole = BigInt(wholeStr);
    const frac = fracStr === "" ? 0n : BigInt(fracStr.padEnd(9, "0"));
    const mist = whole * MIST_PER_SUI + frac;
    if (mist <= 0n) return { ok: false, error: "金额必须大于 0" };

    const maxU64 = (1n << 64n) - 1n;
    if (mist > maxU64) return { ok: false, error: "金额超过 u64 上限" };

    return { ok: true, value: mist };
  } catch {
    return { ok: false, error: "金额格式不正确" };
  }
}
