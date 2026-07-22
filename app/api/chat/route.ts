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

    // 💡 1. Supabase 블록 (DB 직접 뒤지기 + RLS 완벽 보안)
    if (isSupabaseActive && token && supabaseUrl && supabaseAnonKey) {
      // 전달받은 유저의 '신분증(token)'을 사용해 1회용 DB 클라이언트를 만듭니다.
      // 이렇게 하면 무조건 이 유저 본인의 데이터만 가져오게 됩니다. (짬뽕 방지)
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      });

      // 가장 최근 대화 기록 5개 가져오기
      const { data: recentLogs, error } = await supabase
        .from('logs')
        .select('content')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!error && recentLogs && recentLogs.length > 0) {
        dbContext = "[[사용자의 최근 대화/프롬프트 기록]]\n" + recentLogs.map(l => l.content).join('\n') + "\n\n";
      }
    }

    // 💡 2. File System 블록 (첨부 문서 내용 주입)
    if (isFileActive && files && files.length > 0) {
      fileContext = "[[참조할 첨부 파일 문서]]\n" + files.map((f: any) => `[파일명: ${f.name}]\n내용: ${f.content}`).join('\n\n') + "\n\n";
    }

    // 💡 3. AI 시스템 배경지식(System Instruction) 세팅
    // 질문과 배경지식을 분리해서 AI가 더 똑똑하게 대답하게 만듭니다.
    const systemInstruction = `당신은 사용자의 요청을 해결해주는 뛰어난 AI 어시스턴트입니다.\n아래 제공된 배경 정보(과거 기록 및 첨부 문서)를 바탕으로 사용자의 질문에 정확하게 답변하세요.\n만약 배경 정보가 비어있다면, 평소의 지식을 활용해 답변하면 됩니다.\n\n${dbContext}${fileContext}`;

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 모델 세팅 (원했던 3.5 플래시 라이트 적용)
    const modelParams: any = { 
      model: "gemini-3.5-flash-lite",
      systemInstruction: systemInstruction 
    };
    
    // 검색 블록 활성화 시 구글 검색 툴 장착
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