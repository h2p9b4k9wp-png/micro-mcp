import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "[ERROR] API 키가 없습니다." }, { status: 500 });
    }

    const body = await req.json();
    const { prompt, isSearchActive, isSupabaseActive, isFileActive, files, token } = body;

    let dbContext = "";
    let fileContext = "";

    // Supabase DB 블록 (RLS 보안 적용)
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

    // File System 블록 (첨부 문서 내용 주입)
    if (isFileActive && files && files.length > 0) {
      fileContext = "[[참조할 첨부 파일 문서]]\n" + files.map((f: any) => `[파일명: ${f.name}]\n내용: ${f.content}`).join('\n\n') + "\n\n";
    }

    const systemInstruction = `당신은 사용자의 요청을 해결해주는 뛰어난 AI 어시스턴트입니다.\n아래 제공된 배경 정보(과거 기록 및 첨부 문서)를 바탕으로 사용자의 질문에 정확하게 답변하세요.\n만약 배경 정보가 비어있다면, 평소의 지식을 활용해 답변하면 됩니다.\n\n${dbContext}${fileContext}`;

    const genAI = new GoogleGenerativeAI(apiKey);
    
    const modelParams: any = { 
      model: "gemini-3.5-flash-lite",
      systemInstruction: systemInstruction 
    };
    
    if (isSearchActive) {
      modelParams.tools = [{ googleSearch: {} }];
    }

    const model = genAI.getGenerativeModel(modelParams);
    const result = await model.generateContent(prompt);
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