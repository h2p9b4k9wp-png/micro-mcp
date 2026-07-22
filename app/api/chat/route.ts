import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx'; // 💡 엑셀 완벽 분석을 위한 라이브러리 추가

export async function POST(req: Response | Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "[ERROR] GEMINI_API_KEY가 설정되지 않았습니다." }, { status: 500 });
    }

    const body = await (req as Request).json();
    const { prompt, isSearchActive, isSupabaseActive, isFileActive, files, token } = body;

    let dbContext = "";
    const contents: any[] = [];

    // 1. Supabase DB 블록
    if (isSupabaseActive && token && supabaseUrl && supabaseAnonKey) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      });

      const { data: recentLogs, error } = await supabase
        .from('logs')
        .select('content')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!error && recentLogs && recentLogs.length > 0) {
        dbContext = "[[사용자의 최근 대화/프롬프트 기록]]\n" + recentLogs.map(l => l.content).join('\n') + "\n\n";
      }
    }

    // 2. File System 블록 (엑셀 파일 완벽 표 분석 기능 추가)
    let fileTextSummary = "";
    if (isFileActive && files && files.length > 0) {
      for (const f of files) {
        const lowerName = f.name.toLowerCase();

        // 💡 엑셀 및 CSV 파일인 경우 SheetJS로 완벽하게 표 구조 파싱
        if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv')) {
          try {
            // Base64 데이터를 바이너리 버퍼로 변환
            const buffer = Buffer.from(f.content, 'base64');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            
            let excelSummary = `[첨부 엑셀 파일: ${f.name}]\n`;
            
            // 모든 시트를 순회하며 마크다운 표 형식으로 변환
            workbook.SheetNames.forEach(sheetName => {
              const sheet = workbook.Sheets[sheetName];
              // 엑셀 셀 데이터를 JSON(2차원 배열) 형태로 추출
              const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
              
              excelSummary += `\n--- 시트 이름: [ ${sheetName} ] ---\n`;
              if (jsonData && jsonData.length > 0) {
                // 마크다운 표로 깔끔하게 변환하여 AI가 행/열 숫자와 항목을 정확히 매칭하도록 함
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

    const systemInstruction = `당신은 사용자의 요청을 해결해주는 뛰어난 AI 어시스턴트입니다.\n아래 제공된 배경 정보(과거 기록 및 첨부된 엑셀 표 데이터 등)를 바탕으로 사용자의 질문에 완벽하고 상세하게 답변하세요.\n특히 엑셀 파일의 행(Row)과 열(Column)에 기재된 숫자, 금액, 항목명을 정확하게 매칭하여 오차 없이 답변해야 합니다.\n\n${dbContext}${fileTextSummary}`;

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