import * as XLSX from 'xlsx';
import * as CFB from 'cfb';
import { inflateRaw } from 'pako';
import { truncateForPrompt } from '@/lib/truncate-text';

// 문서 파일(base64)에서 순수 텍스트만 뽑아내는 공용 함수입니다. /api/extract가 사용합니다.
// (더 풍부한 처리가 필요한 /api/chat의 파일 분석 블록(OCR, HWP 등)은 이 함수와 별도로 유지됩니다.)

// 💡 [수정] 파서가 한 파일에 대해 절대 넘지 않는 기술적 상한. 예전 값은 20MB였는데, 그건
// "요청 본문에 base64로 실어 보낸다"는 옛 구조 때문에 어차피 도달할 수 없는 숫자였습니다
// (플랫폼 본문 상한 4.5MB → 실제 3.2MB). 이제 파일은 Storage로 직접 올라가고 서버가
// 내려받으므로, 이 값이 진짜로 "서버리스 함수가 감당할 수 있는가"를 정하는 유일한 상한입니다.
//
// 이 값은 추측이 아니라 실측으로 정했습니다(.bench 결과는 커밋 메시지 참고): 압축 포맷은
// 풀었을 때가 진짜 부담이라 원본 크기의 몇 배까지 메모리를 씁니다. 등급별 상한(lib/plan-limits.ts)이
// 이보다 작으면 그쪽이 먼저 걸리고, 이 값은 "어떤 등급이라도 여기서 멈춘다"는 마지막 방어선입니다.
export const MAX_EXTRACT_FILE_BYTES = 100 * 1024 * 1024;

// 💡 [신규] 뽑아낸 글자 수 상한. 파일 크기와 글자 수는 비례하지 않습니다 — 이미지가 대부분인
// 80MB PPTX는 글자가 몇 만 자뿐이지만, 25MB짜리 엑셀 한 장은 수천만 자가 나옵니다. 그 문자열이
// 그대로 응답에 실리고 documents.content 한 행에 저장되므로, 파일 크기 상한만으로는 이쪽이
// 전혀 막히지 않습니다.
//
// 프롬프트에 실제로 들어가는 양은 어차피 6만 자(MAX_PROMPT_TEXT_CHARS)라 이 상한이 답변
// 품질을 깎지 않습니다 — 그보다 5배 여유를 둔 값이라, "나중에 다른 용도로 다시 쓸 때를 위해
// 원문을 넉넉히 남긴다"와 "한 행이 수십 MB가 되지 않게 한다" 사이의 절충입니다.
export const MAX_EXTRACTED_TEXT_CHARS = 300_000;

// 💡 [수정] 실패 사유를 기계가 읽을 수 있는 code로도 함께 실어 보냅니다. message는 예전처럼
// 한국어 문장이라 서버 로그와 게스트 라우트에서 그대로 쓰이지만, 로그인 사용자 화면은
// 이 code로 사용자 언어 문구를 조립합니다(lib/upload-failure-message.ts) — 그러지 않으면
// 어떤 언어로 앱을 쓰든 이 문장만 한국어로 튀어나옵니다.
export type FileExtractErrorCode =
  | 'hwp_too_old'
  | 'hwp_encrypted'
  | 'legacy_office'
  | 'too_large'
  | 'corrupt';

export class FileExtractError extends Error {
  code: FileExtractErrorCode;
  constructor(message: string, code: FileExtractErrorCode = 'corrupt') {
    super(message);
    this.code = code;
  }
}

const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  docx: '워드(.docx)',
  xlsx: '엑셀(.xlsx)',
  xls: '엑셀(.xls)',
  csv: 'CSV',
  pptx: '파워포인트(.pptx)',
  hwpx: '한글(.hwpx)',
  hwp: '한글(.hwp)',
  txt: '텍스트',
};

function workbookToText(workbook: XLSX.WorkBook): string {
  const parts: string[] = [];
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    parts.push(`[시트: ${sheetName}]`);
    rows.forEach((row) => {
      if (row && row.length > 0) parts.push(row.join(' | '));
    });
  });
  return parts.join('\n');
}

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx === -1 ? '' : fileName.slice(idx + 1).toLowerCase();
}

const KNOWN_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'xls', 'csv', 'pptx', 'hwpx', 'hwp', 'txt', 'ics', 'ical', 'ppt', 'doc']);

// 파일명의 확장자만으로는 판별이 안 될 때(확장자가 없거나 못 알아보는 확장자) MIME 타입으로
// 한 번 더 추정합니다. 모바일 브라우저의 공유 시트·클라우드 연동 파일 선택기가 원본 파일명을
// 그대로 안 넘기고 임시 이름(확장자 없음/다른 확장자)을 붙이는 경우가 있는데, 그럴 때도
// File 객체의 MIME 타입(file.type)은 대체로 정확하게 남아있어서 이걸로 구제합니다.
const MIME_TO_EXT: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/pdf': 'pdf',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/msword': 'doc',
};

// /api/extract뿐 아니라 /api/chat의 파일 파싱 분기도 이 함수로 "실제로 다뤄야 할 확장자"를
// 판별합니다 — 파일명 확장자 판별 규칙을 두 곳에 따로 두지 않기 위함입니다.
export function resolveFileExtension(fileName: string, mimeType?: string): string {
  const ext = getExtension(fileName);
  if (KNOWN_EXTENSIONS.has(ext)) return ext;
  if (mimeType && MIME_TO_EXT[mimeType]) return MIME_TO_EXT[mimeType];
  return ext;
}

// XML 태그를 걷어내고 텍스트 노드만 남깁니다 (pptx/hwpx가 공유하는 "압축 풀고 XML에서 글자만 뽑기" 로직).
function extractTextFromXml(xml: string): string {
  const withoutTags = xml.replace(/<[^>]*>/g, '\n');
  const decoded = withoutTags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

  return decoded
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

// 파일명 안의 숫자를 기준으로 정렬합니다 (slide2.xml이 slide10.xml보다 앞에 오도록).
function numericAwareCompare(a: string, b: string): number {
  const numA = a.match(/(\d+)(?=\.xml$)/i)?.[1];
  const numB = b.match(/(\d+)(?=\.xml$)/i)?.[1];
  if (numA && numB) return parseInt(numA, 10) - parseInt(numB, 10);
  return a.localeCompare(b);
}

// zip 안에서 조건에 맞는 XML 항목들을 찾아 텍스트만 이어붙입니다. pptx(ppt/slides)와 hwpx(Contents)가 공유합니다.
async function extractTextFromZipXml(
  buffer: Buffer,
  entryFilter: (path: string) => boolean
): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  const paths = Object.keys(zip.files)
    .filter((path) => !zip.files[path].dir && entryFilter(path))
    .sort(numericAwareCompare);

  const parts: string[] = [];
  for (const path of paths) {
    const xml = await zip.files[path].async('string');
    const text = extractTextFromXml(xml);
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

const HWPTAG_PARA_TEXT = 67;

// HWP 5.0(.hwp)은 CFBF(복합 문서) 컨테이너입니다 — zip이 아닙니다.
// 1) cfb로 컨테이너를 열고 2) FileHeader 스트림에서 압축/암호화 여부를 확인한 뒤
// 3) BodyText/SectionN 스트림들을 꺼내 4) 압축돼 있으면 raw deflate(pako)로 풀고
// 5) 레코드 중 문단 텍스트 레코드(HWPTAG_PARA_TEXT, 태그 67)만 UTF-16LE로 디코딩합니다.
async function extractTextFromHwp(buffer: Buffer): Promise<string> {
  let cfb: CFB.CFB$Container;
  try {
    cfb = CFB.parse(buffer);
  } catch {
    // HWP 3.0 등 아주 옛날 버전은 CFBF 구조 자체가 아니라서 여기서 실패합니다.
    throw new FileExtractError('너무 옛날 버전이에요. 한글에서 열어 HWPX나 PDF로 저장해주세요.', 'hwp_too_old');
  }

  const fileHeaderEntry = CFB.find(cfb, '/FileHeader');
  if (!fileHeaderEntry) {
    throw new FileExtractError('너무 옛날 버전이에요. 한글에서 열어 HWPX나 PDF로 저장해주세요.', 'hwp_too_old');
  }

  const fileHeader = Buffer.from(fileHeaderEntry.content as Uint8Array);
  // FileHeader 36~39바이트: 속성 비트필드(LE uint32). bit0=압축, bit1=암호화.
  const attributes = fileHeader.readUInt32LE(36);
  const isCompressed = (attributes & 0x1) !== 0;
  const isEncrypted = (attributes & 0x2) !== 0;

  if (isEncrypted) {
    throw new FileExtractError('암호가 걸린 한글 파일은 읽을 수 없어요. 암호를 풀고 다시 올려주세요', 'hwp_encrypted');
  }

  const sectionPaths = cfb.FullPaths
    .filter((path) => /\/BodyText\/Section\d+$/i.test(path))
    .sort((a, b) => {
      const numA = parseInt(a.match(/Section(\d+)$/i)?.[1] ?? '0', 10);
      const numB = parseInt(b.match(/Section(\d+)$/i)?.[1] ?? '0', 10);
      return numA - numB;
    });

  const parts: string[] = [];
  for (const path of sectionPaths) {
    const entry = CFB.find(cfb, path);
    if (!entry) continue;
    const raw = Buffer.from(entry.content as Uint8Array);
    const sectionBuffer = isCompressed ? Buffer.from(inflateRaw(raw)) : raw;
    const text = extractParaTextRecords(sectionBuffer);
    if (text) parts.push(text);
  }

  return parts.join('\n\n');
}

// PARA_TEXT 안의 제어 문자는 종류에 따라 차지하는 UTF-16 코드유닛 길이가 다릅니다 — 문자 하나만
// 지우면 나머지가 쓰레기 텍스트로 남으므로, 종류별로 정해진 길이만큼 통째로 건너뜁니다.
// 1글자 차지: 0, 10, 13, 24~31 / 8글자 차지: 1~3, 11, 12, 14~18(확장), 4~9, 19, 20(인라인)
const CONTROL_ONE_UNIT = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
const CONTROL_EIGHT_UNIT = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20]);
// 11 = 표/그림 등 개체 앵커 — 이 제어 문자(8유닛) 뒤가 표가 끝나는 자리라, 줄바꿈을 넣습니다.
const TABLE_OBJECT_CONTROL_CODE = 11;

// PARA_TEXT 페이로드를 UTF-16 코드유닛 단위로 순회하며 제어 문자를 종류별 길이만큼 건너뛰고,
// 남은 코드유닛만 모아 문자열로 복원합니다.
function decodeParaText(payload: Buffer): string {
  const unitCount = Math.floor(payload.length / 2);
  const kept: number[] = [];

  let i = 0;
  while (i < unitCount) {
    const code = payload.readUInt16LE(i * 2);

    if (CONTROL_EIGHT_UNIT.has(code)) {
      if (code === TABLE_OBJECT_CONTROL_CODE) kept.push(0x0a); // 표가 끝나는 자리 — 줄바꿈
      i += 8;
      continue;
    }
    if (CONTROL_ONE_UNIT.has(code) || code <= 0x1f) {
      i += 1; // 목록에 없는 예약된 제어 코드도 안전하게 1유닛만 건너뜀
      continue;
    }

    kept.push(code);
    i += 1;
  }

  const out = Buffer.alloc(kept.length * 2);
  kept.forEach((code, idx) => out.writeUInt16LE(code, idx * 2));
  return out.toString('utf16le');
}

// 레코드 스트림을 순회하며 HWPTAG_PARA_TEXT(67) 레코드만 UTF-16LE로 디코딩합니다.
// 레코드 헤더(LE uint32): bit0-9 태그, bit10-19 레벨, bit20-31 크기(0xFFF면 다음 4바이트가 실제 크기).
function extractParaTextRecords(buffer: Buffer): string {
  const paragraphs: string[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const header = buffer.readUInt32LE(offset);
    offset += 4;

    const tagId = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;
    if (size === 0xfff) {
      if (offset + 4 > buffer.length) break;
      size = buffer.readUInt32LE(offset);
      offset += 4;
    }
    if (offset + size > buffer.length) break;

    if (tagId === HWPTAG_PARA_TEXT) {
      const payload = buffer.subarray(offset, offset + size);
      paragraphs.push(decodeParaText(payload));
    }

    offset += size;
  }

  return paragraphs.join('\n'); // 문단 끝은 줄바꿈으로
}

function tooLargeError(maxBytes: number): FileExtractError {
  const mb = Math.round(maxBytes / (1024 * 1024));
  return new FileExtractError(`파일이 너무 큽니다 (${mb}MB 초과).`, 'too_large');
}

/**
 * 파일(base64)에서 순수 텍스트를 뽑아 돌려줍니다.
 * 지원하지 않는 형식이거나 파일이 손상된 경우 FileExtractError(한국어 메시지)를 던집니다.
 *
 * 💡 base64를 받는 이 형태는 이제 게스트 라우트(public-analyze/public-chat/public-guided-trial)
 * 전용입니다 — 게스트는 로그인이 없어 Storage에 안전하게 쓸 수가 없어서 예전처럼 요청 본문으로
 * 받습니다(상한도 3MB로 낮아 본문 상한에 걸리지 않습니다). 로그인 사용자의 업로드는
 * extractFileTextFromBuffer 쪽으로 갑니다.
 */
export async function extractFileText(
  fileName: string,
  mimeType: string | undefined,
  base64Content: string,
  maxBytes: number = MAX_EXTRACT_FILE_BYTES
): Promise<string> {
  // base64 문자열 길이만으로 대략적인 바이트 수를 먼저 걸러냅니다 — 과도하게 큰 페이로드를
  // 굳이 전부 디코딩하지 않고 빠르게 거부하기 위함입니다.
  const approxBytes = (base64Content.length * 3) / 4;
  if (approxBytes > maxBytes) throw tooLargeError(maxBytes);

  return extractFileTextFromBuffer(fileName, mimeType, Buffer.from(base64Content, 'base64'), maxBytes);
}

/**
 * 파일(Buffer)에서 순수 텍스트를 뽑아 돌려줍니다.
 *
 * 💡 [신규] Supabase Storage에서 내려받은 파일은 이미 Buffer라, base64로 다시 감쌌다가 푸는
 * 왕복이 순수한 낭비입니다 — 큰 파일일수록 그 왕복 자체가 메모리 피크를 1.4배 가까이 키웁니다.
 * (base64 문자열은 원본의 4/3 크기인데, JS 문자열은 UTF-16이라 실제 힙 점유는 그 2배입니다.)
 */
export async function extractFileTextFromBuffer(
  fileName: string,
  mimeType: string | undefined,
  buffer: Buffer,
  maxBytes: number = MAX_EXTRACT_FILE_BYTES
): Promise<string> {
  if (buffer.length > maxBytes) throw tooLargeError(maxBytes);
  const text = await extractRawText(fileName, mimeType, buffer);
  // 💡 [신규] 글자 수 상한은 형식별 분기 바깥에서 한 번만 겁니다 — 분기마다 걸면 새 형식을
  // 추가할 때 빠뜨리기 쉽습니다. 잘릴 때 가운데를 생략하는 건 truncateForPrompt와 같은 이유로,
  // 문서 뒷부분(결론·마감일)이 통째로 사라지지 않게 하기 위함입니다.
  return text.length > MAX_EXTRACTED_TEXT_CHARS ? truncateForPrompt(text, MAX_EXTRACTED_TEXT_CHARS) : text;
}

async function extractRawText(
  fileName: string,
  mimeType: string | undefined,
  buffer: Buffer
): Promise<string> {
  const ext = resolveFileExtension(fileName, mimeType);

  try {
    if (ext === 'hwp') {
      return await extractTextFromHwp(buffer);
    }

    if (ext === 'xlsx' || ext === 'xls') {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      return workbookToText(workbook);
    }

    if (ext === 'csv') {
      // CSV는 바이너리가 아니라 순수 텍스트이므로, 버퍼 그대로 넘기면 SheetJS가 인코딩을 잘못
      // 추측해 한글이 깨질 수 있습니다. UTF-8 문자열로 디코딩한 뒤 문자열로 읽습니다.
      const workbook = XLSX.read(buffer.toString('utf-8'), { type: 'string' });
      return workbookToText(workbook);
    }

    if (ext === 'pdf') {
      const { extractText } = await import('unpdf');
      const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
      return text;
    }

    if (ext === 'docx') {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    }

    if (ext === 'pptx') {
      return await extractTextFromZipXml(buffer, (path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path));
    }

    if (ext === 'hwpx') {
      return await extractTextFromZipXml(buffer, (path) => /^contents\/.*\.xml$/i.test(path));
    }

    // 💡 [신규] 이전 버전 오피스 바이너리 포맷(.doc/.ppt)은 진짜 바이너리라 텍스트로 읽으면
    // 완전히 깨진 문자열만 남습니다 — 조용히 넘기지 않고 재저장을 명확히 안내합니다
    // (app/api/chat의 같은 형식 처리와 동일한 판단, CLAUDE.md 참고).
    if (ext === 'doc' || ext === 'ppt') {
      throw new FileExtractError('이전 버전 파일이에요. 워드/파워포인트에서 열어 .docx/.pptx로 저장해 다시 올려주세요.', 'legacy_office');
    }

    // 💡 [신규] 위에서 처리한 이진 포맷(hwp/xlsx/xls/csv/pdf/docx/pptx/hwpx)이 아니면, 확장자
    // 화이트리스트를 계속 늘리는 대신 일단 UTF-8 텍스트로 읽어봅니다 — 학생이 첨부할 자료는
    // 마크다운 노트(.md), 코드 과제, 일정(.ics), 이름 모를 확장자의 순수 텍스트처럼 형태가
    // 다양한데, 모르는 확장자라고 전부 거부하면 실제로 읽을 수 있는 파일까지 막습니다.
    // 진짜 이진 파일(.zip 등)을 이 경로로 열면 깨진 문자가 섞여 나올 수 있지만, 첨부 내용은
    // 이미 프롬프트에서 "읽을 수 없으면 그렇다고 말하라"는 지침과 함께 신뢰할 수 없는
    // 데이터로 다뤄지므로 이 정도 성능 저하는 감수합니다 — 무조건 거부보다는 낫습니다.
    return buffer.toString('utf-8');
  } catch (err) {
    if (err instanceof FileExtractError) throw err;
    console.error(`파일 텍스트 추출 실패 (${fileName}):`, err);
    const label = FORMAT_LABELS[ext] || `.${ext || '확장자 없음'}`;
    throw new FileExtractError(`${label} 파일을 읽는 중 오류가 발생했어요. 파일이 손상되지 않았는지 확인해주세요.`, 'corrupt');
  }
}
