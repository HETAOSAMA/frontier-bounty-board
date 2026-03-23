import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { buildCreateBountyTx } from "../lib/bounty/tx";
import { formatMistToSui, parseSuiToMist } from "../lib/sui/amount";
import { searchCharacters, type CharacterCandidate } from "../lib/attestor/client";

function parseExpiresAtMs(mode: "never" | "custom", raw: string): { ok: true; value: bigint } | { ok: false; error: string } {
  if (mode === "never") return { ok: true, value: 0n };
  if (!raw.trim()) return { ok: false, error: "请选择过期时间" };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { ok: false, error: "过期时间格式不正确" };
  const now = Date.now();
  if (ms <= now) return { ok: false, error: "过期时间必须晚于当前时间" };
  return { ok: true, value: BigInt(ms) };
}

export function CreateBountyPage(props: {
  builderPackageId: string;
  extensionConfigId: string;
  coinType: string;
}) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [targetName, setTargetName] = useState("");
  const [nameOptions, setNameOptions] = useState<CharacterCandidate[]>([]);
  const [nameLoading, setNameLoading] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterCandidate | null>(null);
  const [amount, setAmount] = useState("");
  const [expiryMode, setExpiryMode] = useState<"never" | "custom">("never");
  const [expiryValue, setExpiryValue] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [createdBountyId, setCreatedBountyId] = useState<string | null>(null);

  const parsedAmount = useMemo(() => parseSuiToMist(amount), [amount]);
  const parsedExpiry = useMemo(() => parseExpiresAtMs(expiryMode, expiryValue), [expiryMode, expiryValue]);

  useEffect(() => {
    const q = targetName.trim();
    setNameError(null);
    setSelectedCharacter(null);
    if (!q) {
      setNameOptions([]);
      return;
    }

    let cancelled = false;
    setNameLoading(true);
    const handle = window.setTimeout(async () => {
      const res = await searchCharacters({ name: q, limit: 10 });
      if (cancelled) return;
      if (!res.ok) {
        setNameOptions([]);
        setNameError(res.error);
        setNameLoading(false);
        return;
      }
      setNameOptions(res.value);
      setNameLoading(false);
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [targetName]);

  function onSelectCharacter(candidate: CharacterCandidate) {
    setSelectedCharacter(candidate);
    setTargetName(candidate.name);
    setNameOptions([]);
    setNameError(null);
  }

  async function onSubmit() {
    setError(null);
    setDigest(null);
    setCreatedBountyId(null);

    if (!account?.address) {
      setError("请先连接钱包");
      return;
    }
    if (!selectedCharacter) {
      setError("请选择目标角色");
      return;
    }
    if (!parsedAmount.ok) {
      setError(parsedAmount.error);
      return;
    }
    if (!parsedExpiry.ok) {
      setError(parsedExpiry.error);
      return;
    }

    try {
      const client = dAppKit.getClient();
      const res = await client.core.getBalance({ owner: account.address, coinType: props.coinType });
      const current = BigInt(res.balance.balance);
      if (current < parsedAmount.value) {
        setError(`余额不足：当前 ${formatMistToSui(current)} SUI，需要 ${formatMistToSui(parsedAmount.value)} SUI（不含 gas）`);
        return;
      }
    } catch (e) {
      setError(`余额检查失败：${String((e as Error | undefined)?.message ?? e)}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const tx = buildCreateBountyTx({
        builderPackageId: props.builderPackageId,
        coinType: props.coinType,
        targetItemId: BigInt(selectedCharacter.item_id),
        targetTenant: selectedCharacter.tenant,
        expiresAt: parsedExpiry.value,
        escrowAmount: parsedAmount.value,
      });

      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const d = (result as unknown as { digest?: unknown }).digest;
      const dStr = typeof d === "string" ? d : null;
      setDigest(dStr);
      void dStr;
    } catch (e) {
      setError(String((e as Error | undefined)?.message ?? e));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Box>
      <Heading size="4">发布赏金</Heading>
      <Box mt="3">
        <Text as="label" size="2">目标角色名（搜索并选择）</Text>
        <input
          style={{ width: "100%" }}
          value={targetName}
          onChange={(e) => setTargetName(e.target.value)}
          placeholder="输入角色名，自动查询"
        />
        <Box mt="2">
          {nameLoading ? <Text size="1">查询中...</Text> : null}
          {nameError ? (
            <Box mt="1" style={{ color: "crimson" }}>
              <Text size="1">{nameError}</Text>
            </Box>
          ) : null}
          {!nameLoading && targetName.trim() && nameOptions.length === 0 && !nameError ? (
            <Text size="1">无匹配结果</Text>
          ) : null}
          {nameOptions.length > 0 ? (
            <Box mt="2" style={{ border: "1px solid #e2e2e2", borderRadius: 8 }}>
              {nameOptions.map((c) => (
                <Box
                  key={`${c.tenant}:${c.item_id}`}
                  p="2"
                  style={{ cursor: "pointer", borderBottom: "1px solid #eee" }}
                  onClick={() => onSelectCharacter(c)}
                >
                  <div>
                    <Text size="2">{c.name}</Text>
                  </div>
                  <div>
                    <Text size="1">tenant: {c.tenant}</Text>
                  </div>
                  <div>
                    <Text size="1">item_id: {c.item_id}</Text>
                  </div>
                  <div>
                    <Text size="1">wallet: {c.character_wallet}</Text>
                  </div>
                </Box>
              ))}
            </Box>
          ) : null}
          {selectedCharacter ? (
            <Box mt="2">
              <Text size="1">
                已选择：{selectedCharacter.name} (tenant={selectedCharacter.tenant}, item_id={selectedCharacter.item_id})
              </Text>
            </Box>
          ) : null}
        </Box>
      </Box>
      <Box mt="3">
        <Text as="label" size="2">金额（SUI）</Text>
        <input
          style={{ width: "100%" }}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="例如：0.1"
        />
      </Box>
      <Box mt="3">
        <Text as="label" size="2">过期时间</Text>
        <Flex gap="3" mt="1" align="center">
          <label>
            <input type="radio" checked={expiryMode === "never"} onChange={() => setExpiryMode("never")} /> 永久
          </label>
          <label>
            <input type="radio" checked={expiryMode === "custom"} onChange={() => setExpiryMode("custom")} /> 自选
          </label>
        </Flex>
        {expiryMode === "custom" ? (
          <input style={{ width: "100%" }} type="datetime-local" value={expiryValue} onChange={(e) => setExpiryValue(e.target.value)} />
        ) : null}
      </Box>
      <Box mt="4">
        <button disabled={isSubmitting} onClick={onSubmit}>
          {isSubmitting ? "发布中..." : "发布"}
        </button>
      </Box>
      {error ? (
        <Box mt="3" style={{ color: "crimson" }}>{error}</Box>
      ) : null}
      {digest ? (
        <Box mt="3">
          <div>交易：{digest}</div>
          {createdBountyId ? <div>BountyId：{createdBountyId}</div> : null}
        </Box>
      ) : null}
    </Box>
  );
}
