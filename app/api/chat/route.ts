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
    // 멀티모달 파트를 담을 배열 (텍스트 + 이미지 파일 등)
    const contents: any[] = [];

    // 1. Supabase DB 블록 (RLS 보안 적용)
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

    // 2. File System 블록 (이미지, PDF, 텍스트 등 멀티모달 컨텍스트 처리)
    let fileTextSummary = "";
    if (isFileActive && files && files.length > 0) {
      for (const f of files) {
        // 이미지가 아닌 일반 텍스트/마크다운 파일인 경우
        if (f.mimeType && f.mimeType.startsWith('text/')) {
          // base64로 들어온 경우 디코딩하거나 그대로 텍스트 합산
          try {
            const decodedText = atob(f.content);
            fileTextSummary += `[파일명: ${f.name}]\n내용:\n${decodedText}\n\n`;
          } catch {
            fileTextSummary += `[파일명: ${f.name}]\n내용:\n${f.content}\n\n`;
          }
        } 
        // 이미지나 기타 멀티모달 파일인 경우 (AI가 직접 시각적으로 분석하도록 주입)
        else if (f.mimeType && (f.mimeType.startsWith('image/') || f.mimeType.includes('pdf'))) {
          contents.push({
            inlineData: {
              data: f.content,
              mimeType: f.mimeType
            }
          });
          fileTextSummary += `[첨부된 멀티모달 파일: ${f.name} (시각 자료 분석 대상 포함)]\n`;
        } else {
          // 기본 텍스트 처리
          fileTextSummary += `[파일명: ${f.name}]\n내용:\n${f.content}\n\n`;
        }
      }
    }

    // 3. 시스템 배경지식 및 프롬프트 조합
    const systemInstruction = `당신은 사용자의 요청을 해결해주는 뛰어난 AI 어시스턴트입니다.\n아래 제공된 배경 정보(과거 기록 및 첨부 파일 정보)를 바탕으로 사용자의 질문에 정확하게 답변하세요.\n\n${dbContext}${fileTextSummary}`;

    const genAI = new GoogleGenerativeAI(apiKey);
    
    const modelParams: any = { 
      model: "gemini-3.5-flash-lite",
      systemInstruction: systemInstruction 
    };
    
    if (isSearchActive) {
      modelParams.tools = [{ googleSearch: {} }];
    }

    const model = genAI.getGenerativeModel(modelParams);

    // 최종 AI에게 보낼 메시지 구성 (이미지 데이터 + 유저 프롬프트)
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