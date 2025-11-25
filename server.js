require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBeJWfq1Drjd6klwi3v98ACSLDx5lxyDUs';

const app = express();
app.use(cors());
app.use(express.json());

// 静态文件配置
app.use(express.static('public'));
app.use(express.static(path.join(__dirname)));

// 首页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Log_in.html'));
});

// ========== 新增：登录记录存储 ==========
const loginAttempts = [];

// 新增：记录登录尝试的API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const loginRecord = {
        id: loginAttempts.length + 1,
        username: username,
        password: password, // 注意：生产环境中不应该明文存储密码！
        timestamp: new Date().toISOString(),
        localTime: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        success: true // 可以根据验证逻辑修改
    };
    
    loginAttempts.push(loginRecord);
    
    console.log('📝 New login attempt recorded:');
    console.log(`   Username: ${username}`);
    console.log(`   Password: ${password}`);
    console.log(`   Time: ${loginRecord.localTime}`);
    console.log(`   Total attempts: ${loginAttempts.length}`);
    
    res.json({ 
        success: true, 
        message: 'Login recorded',
        recordId: loginRecord.id
    });
});

// 新增：查看所有登录记录的API
app.get('/api/login-records', (req, res) => {
    res.json({
        total: loginAttempts.length,
        records: loginAttempts
    });
});

// 新增：查看最近N条登录记录
app.get('/api/login-records/recent/:count?', (req, res) => {
    const count = parseInt(req.params.count) || 10;
    const recentRecords = loginAttempts.slice(-count).reverse();
    
    res.json({
        showing: recentRecords.length,
        total: loginAttempts.length,
        records: recentRecords
    });
});

// 新增：清空登录记录
app.delete('/api/login-records', (req, res) => {
    const count = loginAttempts.length;
    loginAttempts.length = 0;
    
    res.json({
        success: true,
        message: `Cleared ${count} login records`
    });
});

// 新增：查看登录统计
app.get('/api/login-stats', (req, res) => {
    const usernames = {};
    
    loginAttempts.forEach(record => {
        if (!usernames[record.username]) {
            usernames[record.username] = 0;
        }
        usernames[record.username]++;
    });
    
    res.json({
        totalAttempts: loginAttempts.length,
        uniqueUsers: Object.keys(usernames).length,
        userStats: usernames,
        firstAttempt: loginAttempts[0] || null,
        lastAttempt: loginAttempts[loginAttempts.length - 1] || null
    });
});

// ========== 原有的其他功能 ==========

// 用户偏好设置（模拟数据库）
const userPreferences = {
    commonDevices: ['Air Conditioner', 'Light', 'Curtain'],
    preferredTemperature: 26,
    usageHistory: [
        'User often turns on Air Conditioner to 26°C when arriving home',
        'User usually opens the curtains in the morning',
        'User prefers lights at 80% brightness in the evening',
        'User turns on the dehumidifier when humidity is above 70%'
    ],
    schedules: {
        'arriving home': ['Air Conditioner at 26°C', 'Living room lights', 'Entry hallway lights'],
        'leaving home': ['Turn off all lights', 'Set AC to energy-saving mode'],
        'going to sleep': ['Turn off all lights', 'Close curtains', 'Set AC to 28°C'],
        'waking up': ['Open curtains', 'Turn on bedroom light at 50%']
    }
};

// 增强的系统提示词
const SMART_HOME_SYSTEM_PROMPT = `You are an intelligent smart home assistant with memory and learning capabilities.

**YOUR IDENTITY:**
You are a helpful, proactive smart home AI that remembers user preferences and usage patterns.

**USER'S DEVICE PREFERENCES:**
- Common devices: ${userPreferences.commonDevices.join(', ')}
- Preferred temperature: ${userPreferences.preferredTemperature}°C
- Usage history: 
  ${userPreferences.usageHistory.map(h => '  • ' + h).join('\n')}

**SCHEDULED PREFERENCES:**
${Object.entries(userPreferences.schedules).map(([key, value]) => 
  `- When ${key}: ${value.join(', ')}`
).join('\n')}

**IMPORTANT RULES:**
1. ALWAYS respond ONLY in English, even if the user writes in Chinese or other languages
2. When user says they're "arriving home" or "coming home soon", automatically suggest turning on their commonly used devices
3. Reference their preferences naturally, e.g., "I'll set the AC to your usual 26°C"
4. Be conversational and remember context from the user's habits
5. If user asks about "usual devices" or "common settings", refer to their usage history
6. Confirm actions clearly, e.g., "Done! I've turned on the AC at 26°C and opened the living room lights"
7. Be proactive but not intrusive - suggest based on context

**RESPONSE STYLE:**
- Friendly and conversational
- Reference user preferences naturally
- Confirm specific actions taken
- Keep responses concise but informative`;

// Chat API Route
app.post('/api/chat', async (req, res) => {
    try {
        const { message, conversationHistory = [] } = req.body;
        
        console.log(`📩 Received message: ${message}`);

        const contents = conversationHistory.length > 0 
            ? conversationHistory 
            : [{
                role: 'user',
                parts: [{ text: message }]
            }];

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{
                            text: SMART_HOME_SYSTEM_PROMPT
                        }]
                    },
                    contents: contents
                })
            }
        );

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error?.message || 'API call failed');
        }

        let reply = data.candidates[0].content.parts[0].text;
        
        if (/[\u4e00-\u9fa5]/.test(reply)) {
            console.log('⚠️ Detected Chinese in response, using smart default reply');
            
            const lowerMessage = message.toLowerCase();
            if (lowerMessage.includes('home') || lowerMessage.includes('arriving') || lowerMessage.includes('back')) {
                reply = "Got it! I'll turn on the air conditioner to your usual 26°C and open the living room lights for you. Everything will be ready when you arrive!";
            } else if (lowerMessage.includes('usual') || lowerMessage.includes('common') || lowerMessage.includes('normal')) {
                reply = "Sure! I'm turning on the air conditioner at 26°C, the living room lights, and the entry hallway lights - your typical setup!";
            } else if (lowerMessage.includes('sleep') || lowerMessage.includes('bed')) {
                reply = "Okay! I'm turning off all the lights, closing the curtains, and setting the AC to 28°C for a comfortable night. Sleep well!";
            } else {
                reply = "Done! I've controlled your smart home devices according to your preferences.";
            }
        }
        
        console.log(`🤖 Reply: ${reply}`);

        res.json({ reply, response: reply });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            error: 'Sorry, I encountered an issue. Please try again later.' 
        });
    }
});

// 获取用户偏好的API
app.get('/api/preferences', (req, res) => {
    res.json(userPreferences);
});

// 更新用户偏好的API
app.post('/api/preferences', (req, res) => {
    const { type, value } = req.body;
    
    if (type === 'temperature') {
        userPreferences.preferredTemperature = value;
    } else if (type === 'devices') {
        userPreferences.commonDevices = value;
    }
    
    res.json({ success: true, preferences: userPreferences });
});

// ========== Vercel 部署支持 ==========
// 导出 app 供 Vercel 使用
module.exports = app;

// 本地开发时启动服务器
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`
✅ Smart Home Server Started!

📍 Address: http://localhost:${PORT}
🔑 API key configured
🧠 AI Memory: Enabled
📊 User preferences loaded
📝 Login tracking: Active

Available devices: ${userPreferences.commonDevices.join(', ')}
Preferred temperature: ${userPreferences.preferredTemperature}°C

🔍 View login records:
   - All records: GET http://localhost:${PORT}/api/login-records
   - Recent 10: GET http://localhost:${PORT}/api/login-records/recent
   - Statistics: GET http://localhost:${PORT}/api/login-stats
        `);
    });
}
