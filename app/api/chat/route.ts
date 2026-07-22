// 파일 경로: app/api/chat/route.ts

import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { prompt } = body;

    // 브라우저가 아닌 서버 환경이므로 환경 변수를 안전하게 가져옵니다.
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json({ error: 'API 키가 설정되지 않았습니다.' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 무료 티어 한도 초과(429 에러)를 피하기 위해 gemini-3.5-flash-lite 모델 사용
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json({ answer: text });
    
  } catch (error: any) {
    console.error('API Route Error:', error);
    return NextResponse.json(
      { error: error.message || '서버 내부 오류가 발생했습니다.' }, 
      { status: 500 }
    );
  }
}