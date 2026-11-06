// 공통 자료형

export type InstitutionRole = "주관기관" | "참여기관";

/** 과제에 참여하는 기관 (과제관리 현황의 한 줄) */
export interface Institution {
  /** `${과제번호}::${기관명}` */
  key: string;
  projectId: string;
  name: string;
  role: InstitutionRole;
  country: string;
  /** 해외기관 여부 (독촉 메일 언어 결정) */
  foreign: boolean;
  /** 책임연구자 등 받는 사람 이름 */
  contactName: string;
  emails: string[];
}

export interface Project {
  /** 과제번호 (과제 목록의 고유값) */
  id: string;
  /** 과제명 */
  name: string;
  /** 영문 과제명 */
  nameEn: string;
  /** 주관기관 (국내) */
  leadOrg: string;
  /** 해외 참여기관 */
  partnerOrg: string;
  /** 해외기관 국가 */
  country: string;
  /** 담당자 */
  manager: string;
  /** 연차·연도 등 구분값 */
  year: string;
  /** 연락처 이메일 (주관·해외기관 담당자 등 전체) */
  contacts: string[];
  /** 그중 해외기관 연락처 */
  partnerContacts: string[];
  /** 참여 기관 (주관기관 포함) */
  institutions: Institution[];
}

export interface MailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  /** 파일 내용. 이전 작업에서 기록만 남은 메일이면 빈 배열 */
  content: Uint8Array;
  /** 내용 해시 (같은 파일 중복 확인용) */
  sha256: string;
}

export interface ParsedMail {
  /** 메일 고유 키 (Message-ID 또는 원문 해시 기반, 접수대장 키) */
  id: string;
  messageId: string;
  /** 이전 작업에서 기록만 남아 원문·첨부 내용이 없는 메일 */
  stub?: boolean;
  /** 원본 파일명 (.eml) */
  sourceName: string;
  fromName: string;
  fromAddress: string;
  to: string;
  /** ISO 문자열. 없으면 빈 문자열 */
  date: string;
  subject: string;
  text: string;
  attachments: MailAttachment[];
  /** 원본 .eml 바이트 (폴더 정리 시 함께 보관) */
  raw: Uint8Array;
}

export type DocType = string; // 설정에서 정한 서류 종류 이름 또는 "기타"

export interface Candidate {
  projectId: string;
  score: number;
  reasons: string[];
  /** 과제번호·발신자·도메인 같은 확실한 단서가 있는지 (기관명·과제명 언급만으로는 false) */
  strong: boolean;
}

/** auto: 자동 분류, confirmed: 담당자 확인, review: 확인 필요, unmatched: 미분류, excluded: 대상 아님 */
export type MatchStatus = "auto" | "confirmed" | "review" | "unmatched" | "excluded";

export type CheckState = "미점검" | "이상 없음" | "보완 필요";

export interface CheckItem {
  label: string;
  /** true 확인됨, false 없음, null 판단 불가 */
  ok: boolean | null;
  detail: string;
}

export interface DocCheck {
  /** 자동 점검 결과 (브라우저에서 PDF 글자를 읽어 판단) */
  auto?: { kind: "text" | "scan" | "other" | "error"; items: CheckItem[]; suggestion: "ok" | "fix" | "manual" };
  state: CheckState;
  note: string;
  by?: string;
  at?: string;
}

export type KpassState = "등록 대기" | "등록 완료" | "해당 없음";

export interface AttachmentResult {
  index: number;
  filename: string;
  docType: DocType;
  docReason: string;
  sha256?: string;
  size?: number;
  check?: DocCheck;
  kpass?: KpassState;
  kpassAt?: string;
  kpassBy?: string;
}

export interface MailResult {
  mailId: string;
  /** 업무 대상 메일인지 (필터 2차 판단) */
  relevant: boolean;
  relevanceReason: string;
  projectId: string | null;
  confidence: number;
  status: MatchStatus;
  reasons: string[];
  candidates: Candidate[];
  attachments: AttachmentResult[];
  /** 보낸 기관 (과제 안의 기관 key). 알 수 없으면 null */
  institutionKey: string | null;
  institutionReason: string;
  /** 본문 요약 (AI 사용 시) 또는 본문 앞부분 */
  summary: string;
  /** 담당자가 직접 고쳤는지 */
  edited: boolean;
  /** AI 판단을 받았는지 */
  aiAssisted: boolean;
}

/** 서류를 누가 내야 하는지 */
export type DocScope = "주관기관" | "참여기관" | "모든 기관" | "과제 공통";

export interface Settings {
  /** 받아야 하는 서류 종류 */
  requiredDocs: string[];
  /** 서류별 제출 기한 YYYY-MM-DD (없으면 기한 없음) */
  deadlines: Record<string, string>;
  /** K-PASS 운영 중단 기간: 이 기간에 메일로 받은 서류는 'K-PASS 등록 대기' */
  kpassWindow: { from: string; to: string };
  /** 서류를 받을 메일 주소 (안내·독촉 메일에 들어감) */
  submitTo: string;
  /** 수집 메일함에서 이 실이 가져올 폴더 */
  imapFolder: string;
  /** 서류별 제출 대상. "과제 공통"은 과제당 1부(누가 내도 됨) */
  docScope: Record<string, DocScope>;
  /** 서류 종류별 인식 키워드 */
  docKeywords: Record<string, string[]>;
  /** 업무 메일 판단 키워드 (제목·본문·첨부명) */
  relevanceKeywords: string[];
  /** 자동 확정 기준 점수 */
  autoThreshold: number;
  /** 확인 필요 기준 점수 (이보다 낮으면 미분류) */
  reviewThreshold: number;
}
