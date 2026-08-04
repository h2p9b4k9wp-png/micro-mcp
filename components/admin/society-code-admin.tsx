'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SocietyCodeRow {
  id: string;
  code: string;
  label: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  tokensThisMonth: number;
}

// 💡 [신규] app/admin/society-codes/page.tsx(서버 컴포넌트)가 서비스 롤로 미리 조회해둔
// 코드 목록을 받아 렌더링만 하는 클라이언트 컴포넌트 — 데이터 조회 자체는 절대 클라이언트에서
// 하지 않고(서비스 롤 키를 클라이언트로 보낼 수 없으므로), 발급/무효화 같은 쓰기 동작만
// /api/admin/society-codes로 보낸 뒤 router.refresh()로 서버 컴포넌트를 다시 렌더링해
// 최신 상태를 받아옵니다.
export function SocietyCodeAdmin({ initialCodes }: { initialCodes: SocietyCodeRow[] }) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('10');
  const [expiresAt, setExpiresAt] = useState('');
  const [isIssuing, setIsIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justIssued, setJustIssued] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsIssuing(true);
    try {
      const res = await fetch('/api/admin/society-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || undefined,
          maxUses: Number(maxUses),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to issue code.');
        return;
      }
      setJustIssued(data.code.code);
      setLabel('');
      setMaxUses('10');
      setExpiresAt('');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsIssuing(false);
    }
  };

  const handleRevoke = async (codeId: string) => {
    if (!window.confirm('이 코드를 즉시 무효화할까요? 이미 가입한 사람들의 Pro는 유지되고, 신규 사용만 막힙니다.')) return;
    setRevokingId(codeId);
    try {
      const res = await fetch('/api/admin/society-codes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to revoke code.');
        return;
      }
      router.refresh();
    } finally {
      setRevokingId(null);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // 클립보드 접근이 막힌 환경(권한 거부 등)에서는 조용히 무시 — 코드는 화면에 이미 보이므로 수동 복사 가능.
    }
  };

  return (
    <div>
      <form onSubmit={handleIssue} className="bg-[#1C1922] border border-[#2A2632] rounded-xl p-5 mb-8 flex flex-col gap-3">
        <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide">새 코드 발급</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <label className="block text-xs text-[#857C93] mb-1">라벨 (선택)</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="예: OO대학 SW동아리"
              className="w-full bg-[#15131A] border border-[#322D3B] rounded-lg px-3 py-2 text-sm text-[#F5F2F7] outline-none focus:border-[#F4679B]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#857C93] mb-1">사용 가능 인원</label>
            <input
              type="number"
              min={1}
              required
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              className="w-full bg-[#15131A] border border-[#322D3B] rounded-lg px-3 py-2 text-sm text-[#F5F2F7] outline-none focus:border-[#F4679B]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#857C93] mb-1">만료일</label>
            <input
              type="date"
              required
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full bg-[#15131A] border border-[#322D3B] rounded-lg px-3 py-2 text-sm text-[#F5F2F7] outline-none focus:border-[#F4679B]"
            />
          </div>
        </div>
        {error && <p className="text-xs text-[var(--accent-danger)]">{error}</p>}
        {justIssued && (
          <p className="text-xs text-[#6EE7B7]">
            발급 완료: <span className="font-mono font-semibold">{justIssued}</span>
          </p>
        )}
        <button
          type="submit"
          disabled={isIssuing}
          className="self-start bg-[#F4679B] hover:bg-[#D1477F] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg cursor-pointer transition-colors"
        >
          {isIssuing ? '발급 중...' : '코드 발급'}
        </button>
      </form>

      <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-3">발급된 코드</p>
      {initialCodes.length === 0 ? (
        <p className="text-sm text-[#857C93]">아직 발급된 코드가 없어요.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {initialCodes.map((c) => {
            const isExpired = new Date(c.expiresAt).getTime() <= Date.now();
            const isRevoked = Boolean(c.revokedAt);
            const isFull = c.usedCount >= c.maxUses;
            const status = isRevoked ? '무효화됨' : isExpired ? '만료됨' : isFull ? '정원 마감' : '사용 가능';
            const statusColor = isRevoked || isExpired ? 'text-[#857C93]' : isFull ? 'text-[#FFD97D]' : 'text-[#6EE7B7]';
            return (
              <div key={c.id} className="bg-[#1C1922] border border-[#2A2632] rounded-xl p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyCode(c.code)}
                      title="클릭해서 복사"
                      className="font-mono text-sm font-semibold text-[#F5F2F7] hover:text-[#F4679B] transition-colors cursor-pointer"
                    >
                      {c.code}
                    </button>
                    {c.label && <span className="text-xs text-[#857C93]">{c.label}</span>}
                  </div>
                  <span className={`text-xs font-semibold ${statusColor}`}>{status}</span>
                </div>
                <p className="text-xs text-[#857C93]">
                  {c.usedCount} / {c.maxUses}명 가입 · 만료 {new Date(c.expiresAt).toLocaleDateString()} · 이번 달{' '}
                  {c.tokensThisMonth.toLocaleString()} 토큰 사용
                  {c.createdBy && ` · 발급자 ${c.createdBy}`}
                </p>
                {!isRevoked && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(c.id)}
                    disabled={revokingId === c.id}
                    className="mt-2 text-xs text-[var(--accent-danger)]/80 hover:text-[var(--accent-danger)] disabled:opacity-50 cursor-pointer"
                  >
                    {revokingId === c.id ? '무효화하는 중...' : '이 코드 무효화'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
