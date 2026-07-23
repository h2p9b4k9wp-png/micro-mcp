import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx'; // 💡 엑셀 완벽 분석을 위한 라이브러리

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.

export async function POST(req: Request) {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "[ERROR] DEEPSEEK_API_KEY가 설정되지 않았습니다." }, { status: 500 });
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

    // 마감일 인식 블록
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

    // 문서 분석 & 요약 블록 — 엑셀/CSV/텍스트는 그대로 파싱, 이미지·PDF는 현재 DeepSeek 연동에서 미지원
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
          // ⚠️ DeepSeek는 이미지/PDF 인식 지원 여부가 아직 불확실해서, 지금은 안전하게 내용 분석은 건너뛰고 파일이 있다는 것만 알립니다.
          fileTextSummary += `[첨부 파일: ${f.name}] (이미지/PDF 내용 분석은 현재 DeepSeek 연동에서 지원되지 않습니다.)\n\n`;
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

    // 💡 글쓰기 도우미 / 회의·강의 노트 정리 블록
    let modeInstruction = "";
    if (isWritingActive) {
      modeInstruction += "\n[글쓰기 도우미 모드] 사용자가 이메일, 보고서, 자기소개서 등 글쓰기를 요청하면, 목적과 대상에 맞는 톤(격식체/비격식체)을 스스로 판단해서 바로 사용할 수 있는 완성된 초안을 작성해주세요.\n";
    }
    if (isMeetingNotesActive) {
      modeInstruction += "\n[회의·강의 노트 정리 모드] 사용자가 회의록, 강의 필기, 녹음 텍스트를 붙여넣으면 [핵심 요약] / [주요 논의 내용] / [할 일(Action Items)] 세 섹션으로 구조화해서 정리해주세요.\n";
    }

    // ⚠️ DeepSeek에는 실시간 웹 검색 도구가 없어서, 검색 블록이 켜져 있어도 실제 검색은 되지 않습니다.
    // 대신 모델이 최신 정보인 척 지어내지 않도록 명시적으로 안내합니다.
    let searchNote = "";
    if (isSearchActive) {
      searchNote = "\n[안내] 현재 실시간 웹 검색 기능은 연결되어 있지 않습니다. 최신 뉴스, 시세 등 실시간 정보가 필요한 질문에는 정확한 답을 지어내지 말고, 실시간 검색이 필요하다고 사용자에게 솔직하게 알려주세요.\n";
    }

    const systemInstruction = `당신은 사용자의 학업과 업무를 도와주는 뛰어난 AI 어시스턴트입니다.
아래 제공된 배경 정보(최근 대화, 마감일, 첨부 파일 등)를 바탕으로 사용자의 질문에 완벽하고 상세하게 답변하세요.
특히 엑셀 파일의 행(Row)과 열(Column)에 기재된 숫자, 금액, 항목명을 정확하게 매칭하여 오차 없이 답변해야 합니다.
${modeInstruction}${searchNote}
${dbContext}${deadlineContext}${fileTextSummary}`;

    const deepseek = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com',
    });

    const completion = await deepseek.chat.completions.create({
      // 가장 저렴한 모델로 시작합니다. 품질을 올리고 싶으면 'deepseek-v4-pro'로 바꾸면 됩니다.
      model: 'deepseek-v4-flash',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
    });

    const text = completion.choices[0]?.message?.content || '';

    return NextResponse.json({ answer: text });
  } catch (error: any) {
    console.error("API 호출 중 에러 발생:", error);
    return NextResponse.json(
      { error: error.message || "서버 통신 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
