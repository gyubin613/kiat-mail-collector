# 작업 지침: 과제 서류 메일 정리 도우미

K-PASS 밖(메일)으로 들어오는 과제 제출 서류를 분류·정리하는 Next.js 앱. 평가위원 섭외 시스템(gyubin613/Kiat_Claude)과는 별개 저장소.

## 명령어
- `npm run dev` / `npm run typecheck` / `npm test` / `npm run build`
- PR 전 typecheck·test·build 통과

## 지켜야 할 원칙
- 메일·첨부파일은 브라우저에서만 처리한다. 첨부파일 내용을 서버나 AI로 보내는 코드를 넣지 않는다
- AI 호출은 `lib/ai/provider.ts`를 통해서만. AI 결과는 `sanitizeAiResult`로 후보 과제·서류 종류 안에서만 받는다
- 매칭 규칙(`lib/matcher.ts`)을 바꾸면 `tests/pipeline.test.ts`에 시나리오를 추가한다
- 기관명·과제명 언급만으로는 자동 확정하지 않는다 (발신자·도메인·과제번호 단서 필요)
- 가상 데이터는 `scripts/make-samples.mjs`로만 만든다. 도메인은 `.example` 형식, 실제 기관·개인정보 사용 금지
- 화면 문구는 한국어, 쉬운 말
