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

    // 2. File System 블록 (모든 파일 포맷을 에러 없이 강제 분석 대상으로 주입)
    let fileTextSummary = "";
    if (isFileActive && files && files.length > 0) {
      for (const f of files) {
        try {
          // base64로 인코딩된 데이터를 디코딩 시도 (텍스트 파일이나 기타 문서용)
          const decodedText = atob(f.content);
          fileTextSummary += `[첨부 파일: ${f.name}]\n내용:\n${decodedText}\n\n`;
        } catch {
          // 디코딩 실패하거나 바이너리/이미지인 경우 멀티모달 데이터로 직접 첨부
          if (f.mimeType && (f.mimeType.startsWith('image/') || f.mimeType.includes('pdf'))) {
            contents.push({
              inlineData: {
                data: f.content,
                mimeType: f.mimeType
              }
            });
            fileTextSummary += `[첨부 파일 (멀티모달/이미지/문서): ${f.name}]\n`;
          } else {
            // HWP 등 특수 바이너리 파일의 경우 원본 데이터(base64)를 텍스트 형태로라도 AI에게 전달하여 분석 시도
            fileTextSummary += `[첨부 파일 (원문 데이터): ${f.name}]\n원문 데이터 내용:\n${f.content}\n\n`;
          }
        }
      }
    }

    const systemInstruction = `당신은 사용자의 요청을 해결해주는 뛰어난 AI 어시스턴트입니다.\n아래 제공된 배경 정보(과거 기록 및 첨부 파일 내용)를 바탕으로 사용자의 질문에 완벽하고 상세하게 답변하세요. 파일 내용이 복잡하거나 일부 특수 포맷의 문자열이 섞여 있더라도 최선을 다해 핵심을 파악하여 요약하고 분석해 주세요.\n\n${dbContext}${fileTextSummary}`;

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