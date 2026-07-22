import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx'; // 💡 엑셀 완벽 분석을 위한 라이브러리

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "[ERROR] GEMINI_API_KEY가 설정되지 않았습니다." }, { status: 500 });
    }

    const body = await (req as Request).json();
    const {
      prompt,
      isSearchActive,
      isFileActive,
      isDeadlineActive,
      isWritingActive,
      isMeetingNotesActive,
      files,
      deadlines,
      token,
    } = body;

    const contents: any[] = [];

    // 💡 최근 대화 기록은 블록 토글과 상관없이 항상 가볍게 포함해서 대화 연속성을 유지합니다.
    let dbContext = "";
    if (token && supabaseUrl && supabaseAnonKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } }
        });

        const { data: recentLogs, error } = await supabase
          .from('logs')
          .select('content')
          .order('created_at', { ascending: false })
          .limit(3);

        if (!error && recentLogs && recentLogs.length > 0) {
          dbContext = "[[최근 대화 기록]]\n" + recentLogs.map(l => l.content).join('\n') + "\n\n";
        }
      } catch (e) {
        console.error('최근 대화 기록 조회 실패:', e);
      }
    }

    // 💡 [신규] 마감일 인식 블록 — 마감일 매니저에 등록된 일정을 임박한 순으로 컨텍스트에 반영
    let deadlineContext = "";
    if (isDeadlineActive && Array.isArray(deadlines) && deadlines.length > 0) {
      const sorted = [...deadlines].sort(
        (a: any, b: any) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      );
      deadlineContext =
        "[[사용자가 등록한 마감일 목록 (임박한 순)]]\n" +
        sorted.map((d: any) => `- ${d.title}${d.course ? ` (${d.course})` : ''}: ${d.dueAt}`).join('\n') +
        "\n\n";
    }

    // File System 블록 (엑셀 및 CSV 파일인 경우 SheetJS로 완벽하게 표 구조 파싱)
    let fileTextSummary = "";
    if (isFileActive && files && files.length > 0) {
      for (const f of files) {
        const lowerName = f.name.toLowerCase();

        if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv')) {
          try {
            const buffer = Buffer.from(f.content, 'base64');
            const workbook = XLSX.read(buffer, { type: 'buffer' });

            let excelSummary = `[첨부 엑셀 파일: ${f.name}]\n`;

            workbook.SheetNames.forEach(sheetName => {
              const sheet = workbook.Sheets[sheetName];
              const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

              excelSummary += `\n--- 시트 이름: [ ${sheetName} ] ---\n`;
              if (jsonData && jsonData.length > 0) {
                excelSummary += "이 엑셀 표의 실제 데이터와 숫자들입니다:\n";
                jsonData.forEach((row: any, rowIndex: number) => {
                  if (row && row.length > 0) {
                    excelSummary += `행 ${rowIndex + 1}: [ ${row.join(' | ')} ]\n`;
                  }
                });
              } else {
                excelSummary += "(빈 시트입니다)\n";
              }
            });

            fileTextSummary += excelSummary + "\n\n";
          } catch (excelErr) {
            console.error('엑셀 파싱 중 오류:', excelErr);
            fileTextSummary += `[첨부 엑셀 파일: ${f.name}]\n(엑셀 파싱 중 오류가 발생했으나 파일이 첨부되었습니다.)\n\n`;
          }
        }
        else if (lowerName.endsWith('.pptx') || lowerName.endsWith('.ppt') || lowerName.endsWith('.hwp') || lowerName.endsWith('.hwpx') || lowerName.endsWith('.docx')) {
          fileTextSummary += `[첨부 오피스 문서: ${f.name} (${f.size})]\n\n`;
        } else if (f.mimeType && (f.mimeType.startsWith('image/') || f.mimeType.includes('pdf'))) {
          contents.push({
            inlineData: {
              data: f.content,
              mimeType: f.mimeType
            }
          });
          fileTextSummary += `[첨부 시각/문서 파일: ${f.name}]\n`;
        } else {
          try {
            const decodedText = atob(f.content);
            fileTextSummary += `[첨부 파일: ${f.name}]\n내용:\n${decodedText}\n\n`;
          } catch {
            fileTextSummary += `[첨부 파일: ${f.name}]\n내용 요약 참조\n\n`;
          }
        }
      }
    }

    // 💡 [신규] 글쓰기 도우미 / 회의·강의 노트 정리 블록 — 시스템 지시사항에 모드 추가
    let modeInstruction = "";
    if (isWritingActive) {
      modeInstruction += "\n[글쓰기 도우미 모드] 사용자가 이메일, 보고서, 자기소개서 등 글쓰기를 요청하면, 목적과 대상에 맞는 톤(격식체/비격식체)을 스스로 판단해서 바로 사용할 수 있는 완성된 초안을 작성해주세요.\n";
    }
    if (isMeetingNotesActive) {
      modeInstruction += "\n[회의·강의 노트 정리 모드] 사용자가 회의록, 강의 필기, 녹음 텍스트를 붙여넣으면 [핵심 요약] / [주요 논의 내용] / [할 일(Action Items)] 세 섹션으로 구조화해서 정리해주세요.\n";
    }

    const systemInstruction = `당신은 사용자의 학업과 업무를 도와주는 뛰어난 AI 어시스턴트입니다.
아래 제공된 배경 정보(최근 대화, 마감일, 첨부 파일 등)를 바탕으로 사용자의 질문에 완벽하고 상세하게 답변하세요.
특히 엑셀 파일의 행(Row)과 열(Column)에 기재된 숫자, 금액, 항목명을 정확하게 매칭하여 오차 없이 답변해야 합니다.
${modeInstruction}
${dbContext}${deadlineContext}${fileTextSummary}`;

    const genAI = new GoogleGenerativeAI(apiKey);

    const modelParams: any = {
      model: "gemini-3.5-flash-lite",
      systemInstruction: systemInstruction
    };

    if (isSearchActive) {
      modelParams.tools = [{ googleSearch: {} }];
    }

    const model = genAI.getGenerativeModel(modelParams);

    contents.push(prompt);

    const result = await model.generateContent(contents);
    const text = await result.response.text();

    return NextResponse.json({ answer: text });
  } catch (error: any) {
    console.error("API 호출 중 에러 발생:", error);
    return NextResponse.json(
      { error: error.message || "서버 통신 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
