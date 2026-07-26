import * as XLSX from 'xlsx';

// 문서 파일(base64)에서 순수 텍스트만 뽑아내는 공용 함수입니다.
// /api/extract, /api/parse-deadlines가 함께 사용합니다 — 파일 읽는 코드를 두 곳에 두지 않기 위함입니다.
// (더 풍부한 처리가 필요한 /api/chat의 파일 분석 블록(OCR, HWP 등)은 이 함수와 별도로 유지됩니다.)

export const MAX_EXTRACT_FILE_BYTES = 20 * 1024 * 1024;

export class FileExtractError extends Error {}

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

/**
 * 파일(base64)에서 순수 텍스트를 뽑아 돌려줍니다.
 * 지원하지 않는 형식이거나 파일이 손상된 경우 FileExtractError(한국어 메시지)를 던집니다.
 */
export async function extractFileText(
  fileName: string,
  mimeType: string | undefined,
  base64Content: string
): Promise<string> {
  // base64 문자열 길이만으로 대략적인 바이트 수를 먼저 걸러냅니다 — 과도하게 큰 페이로드를
  // 굳이 전부 디코딩하지 않고 빠르게 거부하기 위함입니다.
  const approxBytes = (base64Content.length * 3) / 4;
  if (approxBytes > MAX_EXTRACT_FILE_BYTES) {
    throw new FileExtractError('파일이 너무 큽니다 (20MB 초과).');
  }

  const buffer = Buffer.from(base64Content, 'base64');
  if (buffer.length > MAX_EXTRACT_FILE_BYTES) {
    throw new FileExtractError('파일이 너무 큽니다 (20MB 초과).');
  }

  const ext = getExtension(fileName);

  if (ext === 'hwp') {
    throw new FileExtractError('한글 파일은 [다른 이름으로 저장]에서 HWPX나 PDF로 바꿔서 올려주세요.');
  }

  try {
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

    if (ext === 'txt' || ext === 'ics' || ext === 'ical' || (mimeType && mimeType.startsWith('text/'))) {
      return buffer.toString('utf-8');
    }
  } catch (err) {
    if (err instanceof FileExtractError) throw err;
    console.error(`파일 텍스트 추출 실패 (${fileName}):`, err);
    const label = FORMAT_LABELS[ext] || `.${ext || '확장자 없음'}`;
    throw new FileExtractError(`${label} 파일을 읽는 중 오류가 발생했어요. 파일이 손상되지 않았는지 확인해주세요.`);
  }

  throw new FileExtractError(
    '지원하지 않는 파일 형식이에요. PDF, 워드(.docx), 엑셀(.xlsx/.csv), 파워포인트(.pptx), 한글(.hwpx), 텍스트 파일만 지원해요.'
  );
}
