-- 자료 종류(강의자료/시험지/과제/논문) 표시. 논문(paper)은 /api/analyze-professor가
-- "이 교수님의 연구 관심사" 카테고리를 판단할 때 그 근거로 삼는 유일한 자료 종류입니다.
-- 기존 행은 전부 강의자료로 간주해 기본값을 채웁니다.
alter table public.documents
  add column if not exists doc_type text not null default 'lecture'
  check (doc_type in ('lecture', 'exam', 'assignment', 'paper'));
