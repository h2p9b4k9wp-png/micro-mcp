// 💡 [신규] 지금 서비스 중인 코드가 정확히 어느 커밋인지 페이지에서 바로 확인하기 위한 값.
//
// 왜 필요했나: 코드는 분명히 고쳐서 푸시했는데 화면은 옛 동작 그대로인 상황이 있었습니다.
// 브라우저 캐시인지, 배포가 안 된 건지, 코드가 틀린 건지 구분할 방법이 없어서 엉뚱한 곳을
// 오래 팠습니다(서비스워커부터 지우게 만들었는데 실제로는 Production 도메인이 옛 배포에
// 묶여 있던 문제였습니다). 페이지에 커밋 SHA가 박혀 있으면 그 구분이 5초 만에 끝납니다.
//
// 값은 Vercel이 빌드 시점에 주입하는 시스템 환경변수에서 읽습니다(따로 설정할 필요 없음).
// 로컬 개발에서는 전부 비어 있어 'local'로 표시됩니다.
//
// 공개해도 되는 정보인가: 저장소가 공개라 커밋 SHA·브랜치명은 이미 GitHub에서 볼 수 있는
// 값입니다. 비밀이 아니고, 반대로 이걸 감춰서 얻는 건 디버깅 난이도뿐입니다.

const shortSha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
const branch = process.env.VERCEL_GIT_COMMIT_REF || '';
// 'production' | 'preview' | 'development'. 이번 사고의 핵심이 "Preview인데 Ready라서
// 배포된 줄 알았다"였기 때문에, 커밋만큼이나 이 값이 중요합니다.
const target = process.env.VERCEL_ENV || '';

/**
 * `4dda9e5@main (production)` 형태의 한 줄. 값이 없는 로컬에서는 'local'.
 * app/layout.tsx가 <meta name="build-commit">로 내보냅니다 — 로그인 없이 소스 보기만으로
 * 확인할 수 있어야 해서 화면 요소가 아니라 메타 태그입니다.
 */
export const BUILD_INFO =
  shortSha || branch || target
    ? `${shortSha || 'unknown'}${branch ? `@${branch}` : ''}${target ? ` (${target})` : ''}`
    : 'local';
