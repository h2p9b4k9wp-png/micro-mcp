// 💡 [수정] 로딩 중 보여주는 재미있는 문구 모음 — AI를 부르지 않고 무작위로 골라 씁니다.
// 원래 여기 30개 문구가 한국어로 고정 하드코딩돼 있어서, 다른 로케일로 전환해도 로딩 중엔
// 항상 한국어 문구가 나오는 문제가 있었습니다(교수님 데모 데이터와 같은 유형의 버그).
// 이제 messages/*.json의 loading.messages 배열에서 t.raw()로 읽어옵니다 — 실제 배열 선택은
// components/loading-text.tsx에서 하고, 여기서는 무작위 인덱스 하나만 고릅니다(순수 함수로
// 유지해 컴포넌트 쪽 로직을 단순하게 두기 위함).
export function pickRandomLoadingMessageIndex(length: number): number {
  return Math.floor(Math.random() * length);
}
