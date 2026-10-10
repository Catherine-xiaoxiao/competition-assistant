// Netlify Function - Coze API 代理
// 解决浏览器CORS跨域问题

const COZE_API_BASE = 'https://api.coze.cn';
const COZE_API_KEY = process.env.COZE_API_KEY || 'pat_asq1AleARx1cuH9rITXPypqmlB7eNtaGRN3UCl5h38AIGETZRb8IfALuMBnMHUUV';
const BOT_ID = process.env.BOT_ID || '7693886111492030510';

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const message = body.message;
    const conversationId = body.conversation_id || '';
    const userId = body.user_id || 'web_user_' + Math.random().toString(36).slice(2, 10);

    if (!message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Message is required' }) };
    }

    // Step 1: Create chat
    let url = COZE_API_BASE + '/v3/chat';
    if (conversationId) {
      url += '?conversation_id=' + encodeURIComponent(conversationId);
    }

    const chatResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + COZE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: BOT_ID,
        user_id: userId,
        stream: false,
        auto_save_history: true,
        additional_messages: [{
          role: 'user',
          content: message,
          content_type: 'text'
        }]
      })
    });

    const chatData = await chatResponse.json();
    
    if (!chatData.data || chatData.code !== 0) {
      return { 
        statusCode: 500, 
        headers, 
        body: JSON.stringify({ error: chatData.msg || 'Chat creation failed' }) 
      };
    }

    const chatId = chatData.data.id;
    const newConversationId = chatData.data.conversation_id;
    let status = chatData.data.status;

    // Step 2: Poll for completion
    let maxAttempts = 60; // 最多等2分钟
    let answer = '';

    while (maxAttempts > 0 && status !== 'completed' && status !== 'failed') {
      await new Promise(r => setTimeout(r, 2000));
      
      const statusResp = await fetch(
        COZE_API_BASE + '/v3/chat/status?chat_id=' + chatId + '&conversation_id=' + newConversationId,
        {
          headers: { 'Authorization': 'Bearer ' + COZE_API_KEY }
        }
      );
      
      const statusData = await statusResp.json();
      if (statusData.data) {
        status = statusData.data.status;
      }
      maxAttempts--;
    }

    // Step 3: Get message list
    if (status === 'completed') {
      const msgResp = await fetch(
        COZE_API_BASE + '/v3/chat/message/list?chat_id=' + chatId + '&conversation_id=' + newConversationId,
        {
          headers: { 'Authorization': 'Bearer ' + COZE_API_KEY }
        }
      );
      
      const msgData = await msgResp.json();
      
      if (msgData.data && Array.isArray(msgData.data)) {
        const assistantMsg = msgData.data.find(m => m.role === 'assistant' && m.type === 'answer');
        if (assistantMsg) {
          answer = assistantMsg.content;
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer: answer || '（未获取到回答内容）',
        conversation_id: newConversationId,
        status: status
      })
    };

  } catch (error) {
    console.error('Proxy error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error: ' + error.message })
    };
  }
};
