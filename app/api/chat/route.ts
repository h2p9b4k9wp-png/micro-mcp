import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "[ERROR] GEMINI_API_KEY가 설정되지 않았습니다." }, { status: 500 });
    }

    const body = await req.json();
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

    // 2. File System 블록 (대용량 및 오피스 파일 안전 처리)
    let fileTextSummary = "";
    if (isFileActive && files && files.length > 0) {
      for (const f of files) {
        const lowerName = f.name.toLowerCase();

        // 파워포인트나 한글 등 바이너리 오피스 파일인 경우
        if (lowerName.endsWith('.pptx') || lowerName.endsWith('.ppt') || lowerName.endsWith('.hwp') || lowerName.endsWith('.hwpx') || lowerName.endsWith('.docx')) {
          fileTextSummary += `[첨부 오피스 문서: ${f.name} (${f.size})]\n(안내: 파워포인트 및 문서 파일의 메타데이터가 첨부되었습니다. 슬라이드 내용이나 주요 텍스트를 복사해서 '텍스트 직접 입력'으로 등록해주시면 더욱 정확한 분석이 가능합니다.)\n\n`;
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

    const systemInstruction = `당신은 사용자의 요청을 해결해주는 뛰어난 AI 어시스턴트입니다.\n아래 제공된 배경 정보(과거 기록 및 첨부 파일 정보)를 바탕으로 사용자의 질문에 완벽하고 상세하게 답변하세요.\n\n${dbContext}${fileTextSummary}`;

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