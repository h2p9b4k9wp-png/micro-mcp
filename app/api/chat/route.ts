import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  // 🔥 [디버깅] 서버 터미널에 키가 잘 들어오는지 찍어보기
  console.log("==================================");
  console.log("서버가 읽어온 API 키:", process.env.GEMINI_API_KEY ? "✅ 키가 정상적으로 존재함!" : "❌ 키가 undefined (없음!)");
  console.log("==================================");

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "[ERROR] API 키가 설정되지 않았습니다. .env.local 위치를 확인하세요." },
        { status: 500 }
      );
    }

    // 구글 제미나이 초기화
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 모델 지정 (원하는 제미나이 플래시 라이트 모델명 입력)
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" }); // 3.5를 원한다면 변경 가능

    const body = await req.json();
    const prompt = body.prompt;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json({ answer: text });
  } catch (error: any) {
    console.error("제미나이 API 호출 중 에러 발생:", error);
    return NextResponse.json(
      { error: error.message || "서버 통신 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}