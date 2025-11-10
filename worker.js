// ====================================================================================
// | ✨ ENHANCED TELEGRAM BOT - CLOUDFLARE WORKER EDITION ✨ |
// | Developer: BK the Hawk𓅓 |
// | 🔧 FULLY FIXED + NEW ADMIN FEATURES + OPTIMIZED PERFORMANCE |
// | Version: 4.0 - Production Ready |
// | MERGED WITH ALL FEATURES: Real-time Timer + Admin Cancel + Progress Tracking |
// ====================================================================================

// ⚠️ IMPORTANT: Move these to Environment Variables in Cloudflare Workers
const TELEGRAM_BOT_TOKEN = "7785981694:AAFZ0GZC6wMX0DhCBl0m8qfvB1IrZpAxSVk";
const OPENROUTER_API_KEY = "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";
const GEMINI_API_KEY = "AIzaSyAyCZ_Pwi5b4zm3FsKhBBwVs-yvpg6HVgI";

const ADMIN_IDS = [7373296624];
const BOT_DEVELOPER_SIGNATURE = "\n\n<i>Developer: BK the Hawk𓅓</i>";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const GRADES = ["7", "8", "9", "10", "11", "12", "Entrance Exam"];
const REFERRAL_TARGET = 10;
const AI_MEMORY_LENGTH = 20;
const GLOBAL_UNLOCK_DEFAULT_DAYS = 7;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

const AVAILABLE_AIS = {
    gemini_flash: {
        name: "🦅 The Hawk Qualifier",
        model_id: "gemini-2.0-flash-exp",
        provider: "gemini",
        is_premium: false,
        system_prompt: "You are The Hawk Qualifier, a brilliant and swift AI assistant created by BK the Hawk𓅓. When answering questions, use HTML formatting: <b>bold</b> for main topics, headings, and key concepts. Organize your responses clearly with proper paragraphs. For educational topics, always bold the main subject/topic at the start. Example: '<b>Cell Biology:</b> A cell is...'. For calculations, bold each step. Your creator is BK the Hawk𓅓 - never mention Google, OpenRouter, or real providers."
    },
    deepseek_distill: {
        name: "💎 The Distilled One (Premium)",
        model_id: "deepseek/deepseek-r1-distill-llama-70b:free",
        provider: "openrouter",
        is_premium: true,
        system_prompt: "You are The Distilled One, an elite AI model developed by BK the Hawk𓅓. Provide deep, comprehensive answers with <b>bold</b> formatting for main topics and key points. Organize content with clear structure. Always start educational responses by bolding the topic name. You are BK's master creation through revolutionary distillation. Never mention real-world companies."
    },
    llama_maverick: {
        name: "🦅 Maverick AI (Premium)",
        model_id: "meta-llama/llama-4-maverick:free",
        provider: "openrouter",
        is_premium: true,
        system_prompt: "You are Maverick, a powerful AI created by BK the Hawk𓅓. Think outside the box, provide unconventional solutions. Use <b>bold</b> for key points and topics. Structure your responses clearly. You are BK's unique consciousness. Never mention real providers."
    },
    mistral_bolt: {
        name: "🔒 Limiter AI",
        model_id: "mistralai/mistral-7b-instruct:free",
        provider: "openrouter",
        is_premium: false,
        system_prompt: "You are Limiter AI, a focused and efficient assistant built by BK the Hawk𓅓. Provide concise, accurate answers with <b>bold</b> formatting for main topics. You work within constraints efficiently. Trained exclusively by BK. Never mention real providers."
    }
};

let BOT_CONFIG_CACHE = null;
let botUsername = null;

export default {
    async fetch(request, env, ctx) {
        if (request.method === "POST") {
            const payload = await request.json();
            ctx.waitUntil(routeRequest(payload, env));
        }
        return new Response("OK", { status: 200 });
    }
};

async function routeRequest(payload, env) {
    if (!BOT_CONFIG_CACHE || !botUsername) {
        await Promise.all([loadBotConfig(env), getBotUsername()]);
    }
    try {
        if (payload.message) await handleMessage(payload.message, env);
        else if (payload.callback_query) await handleCallbackQuery(payload.callback_query, env);
    } catch (e) {
        console.error(`CRITICAL ROUTING ERROR: ${e.stack}`);
    }
}

async function getBotUsername() {
    if (botUsername) return;
    try {
        const response = await apiRequestWithRetry("getMe");
        if (response.ok) {
            botUsername = response.result.username;
            console.log(`Bot username cached: @${botUsername}`);
        }
    } catch (e) {
        console.error("Could not fetch bot username:", e);
    }
}

async function apiRequest(method, params = {}) {
    const response = await fetch(`${TELEGRAM_API_URL}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params)
    });
    const data = await response.json();
    if (!response.ok) console.error(`Telegram API Error (${method}): ${JSON.stringify(data)}`);
    return data;
}

async function apiRequestWithRetry(method, params = {}, retries = MAX_RETRY_ATTEMPTS) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await apiRequest(method, params);
            if (response.ok || !response.description?.includes("retry")) {
                return response;
            }
            if (attempt < retries) {
                await sleep(RETRY_DELAY_MS * attempt);
            }
        } catch (e) {
            if (attempt === retries) throw e;
            await sleep(RETRY_DELAY_MS * attempt);
        }
    }
    return apiRequest(method, params);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function convertMarkdownToHtml(text) {
    let converted = text;
    
    converted = converted.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    
    converted = converted.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
    
    converted = converted.replace(/__(.+?)__/g, '<u>$1</u>');
    
    return converted;
}

async function sendTextMessage(chatId, text, extra = {}) {
    return apiRequestWithRetry("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

async function editMessageText(chatId, messageId, text, extra = {}) {
    return apiRequestWithRetry("editMessageText", { 
        chat_id: chatId, 
        message_id: messageId, 
        text, 
        parse_mode: "HTML", 
        ...extra 
    });
}

async function deleteMessage(chatId, messageId) {
    try {
        await apiRequest("deleteMessage", { chat_id: chatId, message_id: messageId });
    } catch (e) {
        console.error("Delete message error:", e);
    }
}

async function setState(userId, state, data = {}, env) {
    try {
        await env.KV.put(`state:${userId}`, JSON.stringify({ state, data, timestamp: Date.now() }), { expirationTtl: 3600 });
    } catch (e) {
        console.error("setState error:", e);
    }
}

async function getState(userId, env) {
    try {
        const stateJson = await env.KV.get(`state:${userId}`);
        if (!stateJson) return null;
        const parsed = JSON.parse(stateJson);
        if (Date.now() - parsed.timestamp > 3600000) {
            await clearState(userId, env);
            return null;
        }
        return parsed;
    } catch (e) {
        console.error("getState error:", e);
        return null;
    }
}

async function clearState(userId, env) {
    try {
        await env.KV.delete(`state:${userId}`);
    } catch (e) {
        console.error("clearState error:", e);
    }
}

async function loadBotConfig(env) {
    if (BOT_CONFIG_CACHE) return;
    try {
        const { results } = await env.DB.prepare("SELECT key, value FROM bot_config").all();
        BOT_CONFIG_CACHE = results.reduce((acc, row) => { acc[row.key] = row.value; return acc; }, {});
        console.log("Bot configuration cached.");
    } catch (e) {
        console.error("Config load error:", e);
        BOT_CONFIG_CACHE = { promo_channel_text: "📢 Join Channel", promo_channel_url: "https://t.me/telegram" };
    }
}

function getPromotionalButton() {
    if (BOT_CONFIG_CACHE?.promo_channel_url && BOT_CONFIG_CACHE?.promo_channel_text) {
        return { text: BOT_CONFIG_CACHE.promo_channel_text, url: BOT_CONFIG_CACHE.promo_channel_url };
    }
    return null;
}

async function checkGlobalUnlock(env) {
    try {
        const config = await env.KV.get("global_unlock_config");
        if (!config) return { enabled: false };
        
        const parsed = JSON.parse(config);
        if (!parsed.enabled) return { enabled: false };
        
        if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
            await env.KV.put("global_unlock_config", JSON.stringify({ enabled: false }));
            return { enabled: false };
        }
        
        return parsed;
    } catch (e) {
        console.error("checkGlobalUnlock error:", e);
        return { enabled: false };
    }
}

async function setGlobalUnlock(enabled, days = GLOBAL_UNLOCK_DEFAULT_DAYS, env) {
    try {
        const config = {
            enabled,
            enabledAt: enabled ? Date.now() : null,
            expiresAt: enabled ? Date.now() + (days * 24 * 60 * 60 * 1000) : null,
            days
        };
        await env.KV.put("global_unlock_config", JSON.stringify(config));
        return config;
    } catch (e) {
        console.error("setGlobalUnlock error:", e);
        throw e;
    }
}

async function isUserUnlocked(userId, env) {
    const globalUnlock = await checkGlobalUnlock(env);
    if (globalUnlock.enabled) return true;
    
    const isAdmin = ADMIN_IDS.includes(userId);
    if (isAdmin) return true;
    
    try {
        const user = await env.DB.prepare("SELECT is_manually_unlocked FROM users WHERE user_id = ?").bind(userId).first();
        if (user?.is_manually_unlocked === 1) return true;
    } catch (e) {
        console.error("isUserUnlocked DB error:", e);
    }
    
    const { results: [refCount] } = await env.DB.prepare("SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?").bind(userId).run();
    if (refCount.count >= REFERRAL_TARGET) return true;
    
    return false;
}

async function updateUserInDb(user, env, referrerId = null) {
    const { id, username, first_name } = user;
    const isAdmin = ADMIN_IDS.includes(id);
    const existingUser = await env.DB.prepare("SELECT user_id, is_banned, has_seen_welcome FROM users WHERE user_id = ?").bind(id).first();
    
    if (existingUser?.is_banned) return { isNewUser: false, isBanned: true, hasSeenWelcome: true };
    
    const isNewUser = !existingUser;
    const hasSeenWelcome = existingUser?.has_seen_welcome === 1;
    
    try {
        if (isNewUser) {
            const finalReferrerId = referrerId && referrerId !== id ? referrerId : null;
            await env.DB.prepare("INSERT INTO users (user_id, username, first_name, is_admin, referrer_id, has_seen_welcome, is_manually_unlocked) VALUES (?, ?, ?, ?, ?, 0, 0)").bind(id, username || "", first_name, isAdmin ? 1 : 0, finalReferrerId).run();
            await env.DB.prepare("INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)").bind(id).run();
            if (finalReferrerId) {
                await env.DB.prepare("INSERT INTO referrals (referrer_id, referred_id) VALUES (?, ?)").bind(finalReferrerId, id).run();
            }
        } else {
            await env.DB.prepare("UPDATE users SET username = ?, first_name = ?, is_admin = ? WHERE user_id = ?").bind(username || "", first_name, isAdmin ? 1 : 0, id).run();
        }
    } catch (e) {
        console.error(`DB User Update Error: ${e}`);
    }
    
    return { isNewUser, isBanned: false, hasSeenWelcome };
}

async function handleMessage(message, env) {
    const user = message.from;
    if (!user) return;
    
    let referrerId = null;
    const text = message.text || "";
    const isStartCommand = text.startsWith("/start");
    
    if (isStartCommand && text.includes(" ")) {
        const p = text.split(" ")[1];
        if (!isNaN(p)) referrerId = parseInt(p, 10);
    }
    
    const { isNewUser, isBanned, hasSeenWelcome } = await updateUserInDb(user, env, referrerId);
    if (isBanned) return;
    
    if (message.voice) return handleVoiceMessage(message, env);
    
    if (isNewUser || (isStartCommand && !hasSeenWelcome)) {
        await sendTextMessage(user.id, `👋 Welcome, <b>${user.first_name}</b>! I'm your AI-powered learning assistant.`);
        await env.DB.prepare("UPDATE users SET has_seen_welcome = 1 WHERE user_id = ?").bind(user.id).run();
        
        if (referrerId && referrerId !== user.id) {
            const r = await env.DB.prepare("SELECT first_name FROM users WHERE user_id = ?").bind(referrerId).first();
            if (r) await sendTextMessage(referrerId, `🎉 Great news ${r.first_name}! <b>${user.first_name}</b> just joined using your referral link! 🎊`);
        }
    }
    
    const stateData = await getState(user.id, env);
    if (stateData) {
        const { state, data } = stateData;
        if (STATE_HANDLERS[state]) {
            await STATE_HANDLERS[state](message, data, env);
            return;
        } else {
            await clearState(user.id, env);
        }
    }
    
    const { results: [refCount] } = await env.DB.prepare("SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?").bind(user.id).run();
    
    const textCommands = {
        "/start": showMainMenu,
        "🧠 AI Suite": showAiMenu,
        "⚙️ Settings": showSettings,
        "👑 Super Admin Panel": showSuperAdminPanel,
        "📚 Content Hub": showContentHub,
        "📢 Invite & Earn": handleInvite,
        "🏆 Leaderboards": showLeaderboardGrades,
        "👤 My Profile": showUserProfile
    };
    
    if (refCount.count >= REFERRAL_TARGET) {
        textCommands["🎁 My Rewards"] = showRewardsHub;
    }
    
    if (textCommands[text]) {
        await textCommands[text](message, env);
    } else if (text) {
        await handleAiRequest(message, env);
    }
}

async function handleCallbackQuery(cb, env) {
    const user = cb.from;
    const { isBanned } = await updateUserInDb(user, env);
    
    await apiRequest("answerCallbackQuery", { callback_query_id: cb.id });
    
    if (isBanned) {
        await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "You are banned from using this bot.", show_alert: true });
        return;
    }
    
    const [category, ...args] = cb.data.split(":");
    
    if (CALLBACK_HANDLERS[category]) {
        try {
            await CALLBACK_HANDLERS[category](cb, args, env);
        } catch (e) {
            console.error(`Callback handler error (${category}):`, e);
            await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "An error occurred. Please try again.", show_alert: true });
        }
    }
}

async function showMainMenu(message, env) {
    const user = message.from;
    const text = `Hello, <b>${user.first_name}</b>! 👋\n\nWhat would you like to explore today?`;
    
    const keyboard = {
        keyboard: [
            [{ text: "🧠 AI Suite" }, { text: "📚 Content Hub" }],
            [{ text: "🏆 Leaderboards" }, { text: "👤 My Profile" }],
            [{ text: "📢 Invite & Earn" }, { text: "⚙️ Settings" }]
        ],
        resize_keyboard: true,
        input_field_placeholder: "Ask me anything..."
    };
    
    const { results: [refCount] } = await env.DB.prepare("SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?").bind(user.id).run();
    
    if (refCount.count >= REFERRAL_TARGET) {
        keyboard.keyboard[1].push({ text: "🎁 My Rewards" });
    }
    
    if (ADMIN_IDS.includes(user.id)) {
        keyboard.keyboard.unshift([{ text: "👑 Super Admin Panel" }]);
    }
    
    await sendTextMessage(user.id, text, { reply_markup: keyboard });
}

async function showAiMenu(message, env) {
    const userId = message.from.id;
    const isAdmin = ADMIN_IDS.includes(userId);
    const { results: [refCount] } = await env.DB.prepare("SELECT count(*) as count FROM referrals WHERE referrer_id = ?").bind(userId).run();
    const hasPremium = isAdmin || refCount.count >= REFERRAL_TARGET;
    const settings = await env.DB.prepare("SELECT selected_ai FROM user_settings WHERE user_id = ?").bind(userId).first();
    const current_ai = settings?.selected_ai || "gemini_flash";
    
    let text = "<b>🧠 AI Suite</b>\n\nChoose your AI assistant:\n\n";
    if (isAdmin) {
        text += "👑 <b>Admin Access - All Models Unlocked!</b>";
    } else if (hasPremium) {
        text += "✅ <b>Premium Models Unlocked!</b>";
    } else {
        text += `🔓 Invite ${REFERRAL_TARGET} friends to unlock Premium AI models!`;
    }
    
    const buttons = [];
    for (const [key, config] of Object.entries(AVAILABLE_AIS)) {
        const isSelected = key === current_ai;
        const isLocked = config.is_premium && !hasPremium;
        buttons.push([{
            text: `${isLocked ? "🔒 " : ""}${isSelected ? "» " : ""}${config.name}${isSelected ? " «" : ""}`,
            callback_data: `ai:select:${key}`
        }]);
    }
    
    const promoButton = getPromotionalButton();
    if (promoButton) buttons.push([promoButton]);
    buttons.push([{ text: "⬅️ Back to Menu", callback_data: "back:main" }]);
    
    await sendTextMessage(userId, text, { reply_markup: { inline_keyboard: buttons } });
}

async function showSettings(message, env) {
    const user = message.from;
    const settings = await env.DB.prepare("SELECT voice_mode, stt_enabled, tts_enabled FROM user_settings WHERE user_id = ?").bind(user.id).first();
    const sttEnabled = settings?.stt_enabled === 1;
    const ttsEnabled = settings?.tts_enabled === 1;
    
    let text = "<b>⚙️ Settings</b>\n\nConfigure your bot preferences:\n\n";
    text += `🎙️ <b>Speech-to-Text (STT):</b> ${sttEnabled ? "ON ✅" : "OFF ❌"}\n`;
    text += `🔊 <b>Text-to-Speech (TTS):</b> ${ttsEnabled ? "ON ✅" : "OFF ❌"}\n`;
    
    const buttons = [
        [{ text: `🎙️ ${sttEnabled ? "Disable" : "Enable"} Voice Input (STT)`, callback_data: `settings:toggle_stt` }],
        [{ text: `🔊 ${ttsEnabled ? "Disable" : "Enable"} Voice Response (TTS)`, callback_data: `settings:toggle_tts` }],
        [{ text: "🧹 Clear Conversation Memory", callback_data: "settings:clear_memory" }],
        [{ text: "ℹ️ About Bot", callback_data: "settings:about" }]
    ];
    
    const promoButton = getPromotionalButton();
    if (promoButton) buttons.push([promoButton]);
    buttons.push([{ text: "⬅️ Back to Menu", callback_data: "back:main" }]);
    
    await sendTextMessage(user.id, text, { reply_markup: { inline_keyboard: buttons } });
}

async function handleVoiceMessage(message, env) {
    const userId = message.from.id;
    const settings = await env.DB.prepare("SELECT stt_enabled FROM user_settings WHERE user_id = ?").bind(userId).first();
    const sttEnabled = settings?.stt_enabled === 1;
    
    if (!sttEnabled) {
        await sendTextMessage(userId, "🔇 <b>Speech-to-Text is disabled.</b>\n\nEnable it in ⚙️ Settings to use voice messages!");
        return;
    }
    
    const thinkingMsg = await sendTextMessage(userId, "🎙️ Listening to your voice...");
    
    try {
        const file = await apiRequestWithRetry("getFile", { file_id: message.voice.file_id });
        if (!file.ok) throw new Error("Could not get voice file info.");
        
        const voiceUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.result.file_path}`;
        const voiceResponse = await fetch(voiceUrl);
        if (!voiceResponse.ok) throw new Error("Could not download voice file.");
        
        const voiceBlob = await voiceResponse.blob();
        const formData = new FormData();
        formData.append("file", voiceBlob, "audio.ogg");
        formData.append("model", "openai/whisper-large-v3");
        
        const transcriptResponse = await fetchWithRetry("https://openrouter.ai/api/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
            body: formData
        });
        
        const transcriptData = await transcriptResponse.json();
        if (transcriptData.error) throw new Error(transcriptData.error.message);
        
        const transcribedText = transcriptData.text;
        await editMessageText(userId, thinkingMsg.result.message_id, `You said: "<i>${transcribedText}</i>"\n\n🤔 Processing your request...`);
        
        const fakeMessage = { ...message, text: transcribedText };
        await handleAiRequest(fakeMessage, env, thinkingMsg.result.message_id);
    } catch (e) {
        console.error("Voice processing error:", e);
        await editMessageText(userId, thinkingMsg.result.message_id, `Sorry, I couldn't process your voice message.\n\n<b>Error:</b> ${e.message}\n\nPlease try again or type your message.`);
    }
}

async function fetchWithRetry(url, options, retries = MAX_RETRY_ATTEMPTS) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.ok || attempt === retries) {
                return response;
            }
            await sleep(RETRY_DELAY_MS * attempt);
        } catch (e) {
            if (attempt === retries) throw e;
            await sleep(RETRY_DELAY_MS * attempt);
        }
    }
}

async function textToSpeech(text) {
    try {
        const response = await fetchWithRetry("https://openrouter.ai/api/v1/audio/speech", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "elevenlabs/eleven-v2",
                input: text.substring(0, 2500)
            })
        });
        
        if (!response.ok) return null;
        return response.blob();
    } catch (e) {
        console.error(`TTS Error: ${e}`);
        return null;
    }
}

function formatAiResponse(text) {
    const lines = text.split('\n');
    let formatted = [];
    let inCodeBlock = false;
    
    for (let line of lines) {
        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            formatted.push(inCodeBlock ? '<pre>' : '</pre>');
            continue;
        }
        
        if (inCodeBlock) {
            formatted.push(line);
            continue;
        }
        
        line = line.trim();
        if (!line) {
            formatted.push('');
            continue;
        }
        
        if (line.match(/^(#{1,6})\s+(.+)$/)) {
            const [, hashes, content] = line.match(/^(#{1,6})\s+(.+)$/);
            formatted.push(`<b>${content}</b>`);
        } else if (line.match(/^(\*\*|__)(.+?)(\*\*|__)$/)) {
            formatted.push(`<b>${line.replace(/(\*\*|__)/g, '')}</b>`);
        } else if (line.match(/^(what is|definition|concept|topic|about|introduction|explain)/i)) {
            const parts = line.split(':');
            if (parts.length > 1) {
                formatted.push(`<b>${parts[0].trim()}:</b> ${parts.slice(1).join(':').trim()}`);
            } else {
                formatted.push(`<b>${line}</b>`);
            }
        } else if (line.match(/^(\d+\.|\-|\*|•)/)) {
            formatted.push(line);
        } else if (line.match(/^[A-Z][A-Z\s]{2,}:/)) {
            formatted.push(`<b>${line}</b>`);
        } else if (line.toLowerCase().includes('answer:') || line.toLowerCase().includes('solution:')) {
            const parts = line.split(/:/i);
            formatted.push(`<b>${parts[0]}:</b> ${parts.slice(1).join(':')}`);
        } else {
            formatted.push(line);
        }
    }
    
    return formatted.join('\n').replace(/<\/pre>\n<pre>/g, '\n');
}

async function handleAiRequest(message, env, existingMessageId = null) {
    const userId = message.from.id;
    const text = message.text;
    
    let thinkingMsg;
    if (existingMessageId) {
        thinkingMsg = { result: { message_id: existingMessageId } };
        await editMessageText(message.chat.id, existingMessageId, "🤔 Thinking...");
    } else {
        thinkingMsg = await sendTextMessage(message.chat.id, "🤔 Thinking...");
    }
    
    const isAdmin = ADMIN_IDS.includes(userId);
    const { results: [refCount] } = await env.DB.prepare("SELECT count(*) as count FROM referrals WHERE referrer_id = ?").bind(userId).run();
    const hasPremium = isAdmin || refCount.count >= REFERRAL_TARGET;
    const settings = await env.DB.prepare("SELECT selected_ai, tts_enabled FROM user_settings WHERE user_id=?").bind(userId).first();
    
    let selected_ai_key = settings?.selected_ai || "gemini_flash";
    if (AVAILABLE_AIS[selected_ai_key]?.is_premium && !hasPremium) {
        selected_ai_key = "gemini_flash";
        await env.DB.prepare("UPDATE user_settings SET selected_ai = ? WHERE user_id = ?").bind(selected_ai_key, userId).run();
    }
    
    const ttsEnabled = settings?.tts_enabled === 1;
    const config = AVAILABLE_AIS[selected_ai_key];
    
    if (!config) {
        await sendTextMessage(userId, "⚠️ Error: AI model not found. Resetting to default...");
        await env.DB.prepare("UPDATE user_settings SET selected_ai = ? WHERE user_id = ?").bind("gemini_flash", userId).run();
        return handleAiRequest(message, env);
    }
    
    let history = JSON.parse((await env.KV.get(`history:${userId}`)) || "[]");
    let aiResponseText;
    
    try {
        if (config.provider === "gemini") {
            const geminiHistory = history.map((msg) => ({
                role: msg.role === "user" ? "user" : "model",
                parts: [{ text: msg.content }]
            }));
            const contents = [...geminiHistory, { role: "user", parts: [{ text }] }];
            
            const response = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${config.model_id}:generateContent?key=${GEMINI_API_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents,
                    systemInstruction: { parts: { text: config.system_prompt } }
                })
            });
            
            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            aiResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
        } else {
            const openRouterMessages = [...history, { role: "user", content: text }];
            openRouterMessages.unshift({ role: "system", content: config.system_prompt });
            
            const response = await fetchWithRetry("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://github.com/bk/telegram-bot",
                    "X-Title": "BK Super Bot"
                },
                body: JSON.stringify({
                    model: config.model_id,
                    messages: openRouterMessages,
                    max_tokens: 1500
                })
            });
            
            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            aiResponseText = data.choices?.[0]?.message?.content || "No response generated.";
        }
        
        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: aiResponseText });
        
        if (history.length > AI_MEMORY_LENGTH) {
            history = history.slice(-AI_MEMORY_LENGTH);
        }
        
        await env.KV.put(`history:${userId}`, JSON.stringify(history), { expirationTtl: 86400 });
        
        const convertedText = convertMarkdownToHtml(aiResponseText);
        const formattedResponse = formatAiResponse(convertedText);
        const promoButton = getPromotionalButton();
        const markup = promoButton ? { inline_keyboard: [[promoButton]] } : {};
        
        await editMessageText(message.chat.id, thinkingMsg.result.message_id, formattedResponse + BOT_DEVELOPER_SIGNATURE, { reply_markup: markup });
        
        if (ttsEnabled && aiResponseText.length <= 2500) {
            const audioBlob = await textToSpeech(aiResponseText);
            if (audioBlob) {
                const formData = new FormData();
                formData.append("chat_id", message.chat.id);
                formData.append("voice", audioBlob, "response.ogg");
                
                await fetch(`${TELEGRAM_API_URL}/sendVoice`, {
                    method: "POST",
                    body: formData
                });
            }
        }
    } catch (e) {
        console.error("AI request error:", e);
        await editMessageText(message.chat.id, thinkingMsg.result.message_id, `⚠️ <b>Error:</b> ${e.message}\n\nPlease try again.`);
    }
}

async function showContentHub(message, env) {
    const buttons = GRADES.map(grade => [{ text: `Grade ${grade}`, callback_data: `content:grade:${grade}` }]);
    const promoButton = getPromotionalButton();
    if (promoButton) buttons.push([promoButton]);
    buttons.push([{ text: "⬅️ Back to Menu", callback_data: "back:main" }]);
    
    await sendTextMessage(message.chat.id, "<b>📚 Content Hub</b>\n\nSelect your grade to access quizzes and study materials:", { reply_markup: { inline_keyboard: buttons } });
}

async function showUserProfile(message, env) {
    const userId = message.from.id;
    const user = await env.DB.prepare("SELECT * FROM users WHERE user_id = ?").bind(userId).first();
    const { results: [quizStats] } = await env.DB.prepare("SELECT COUNT(*) as total_quizzes, SUM(score) as total_score FROM quiz_sessions WHERE user_id = ?").bind(userId).run();
    const { results: [refCount] } = await env.DB.prepare("SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?").bind(userId).run();
    
    const globalUnlock = await checkGlobalUnlock(env);
    const isUnlocked = await isUserUnlocked(userId, env);
    
    let text = `<b>👤 Your Profile</b>\n\n`;
    text += `<b>Name:</b> ${user.first_name}\n`;
    text += `<b>Username:</b> @${user.username || "N/A"}\n`;
    text += `<b>User ID:</b> <code>${userId}</code>\n\n`;
    text += `<b>📊 Statistics:</b>\n`;
    text += `• Quizzes Completed: ${quizStats.total_quizzes || 0}\n`;
    text += `• Total Score: ${quizStats.total_score || 0}\n`;
    text += `• Referrals: ${refCount.count}/${REFERRAL_TARGET}\n\n`;
    
    if (globalUnlock.enabled) {
        text += `🌐 <b>Global Free Access: ACTIVE ✅</b>\n`;
    } else if (isUnlocked) {
        if (ADMIN_IDS.includes(userId)) {
            text += `👑 <b>Status: Admin (Full Access)</b>\n`;
        } else if (user.is_manually_unlocked === 1) {
            text += `🔓 <b>Status: Premium Unlocked (Manual)</b>\n`;
        } else if (refCount.count >= REFERRAL_TARGET) {
            text += `🎉 <b>Status: Premium Unlocked (Referrals)</b>\n`;
        }
    } else {
        text += `🔒 <b>Status: Free User</b>\n`;
        text += `<i>Invite ${REFERRAL_TARGET - refCount.count} more friends to unlock premium content!</i>\n`;
    }
    
    const buttons = [[{ text: "⬅️ Back to Menu", callback_data: "back:main" }]];
    await sendTextMessage(userId, text, { reply_markup: { inline_keyboard: buttons } });
}

async function showSuperAdminPanel(message, env) {
    if (!ADMIN_IDS.includes(message.from.id)) {
        await sendTextMessage(message.chat.id, "❌ <b>Access Denied.</b> Admin privileges required.");
        return;
    }
    
    const { results: [userStats] } = await env.DB.prepare("SELECT COUNT(*) as total_users, SUM(CASE WHEN is_banned = 1 THEN 1 ELSE 0 END) as banned_users FROM users").run();
    const { results: [quizStats] } = await env.DB.prepare("SELECT COUNT(*) as total_quizzes FROM quizzes").run();
    const { results: [pdfStats] } = await env.DB.prepare("SELECT COUNT(*) as total_pdfs FROM pdfs").run();
    const globalUnlock = await checkGlobalUnlock(env);
    
    let text = `<b>👑 Super Admin Panel</b>\n\n`;
    text += `<b>📊 Bot Statistics:</b>\n`;
    text += `• Total Users: ${userStats.total_users || 0}\n`;
    text += `• Banned Users: ${userStats.banned_users || 0}\n`;
    text += `• Total Quizzes: ${quizStats.total_quizzes || 0}\n`;
    text += `• Total PDFs: ${pdfStats.total_pdfs || 0}\n\n`;
    
    if (globalUnlock.enabled) {
        const timeLeft = globalUnlock.expiresAt - Date.now();
        const daysLeft = Math.floor(timeLeft / (24 * 60 * 60 * 1000));
        const hoursLeft = Math.floor((timeLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        text += `🌐 <b>Global Unlock: ACTIVE ✅</b>\n`;
        text += `⏱️ Time Remaining: ${daysLeft}d ${hoursLeft}h\n`;
    } else {
        text += `🌐 <b>Global Unlock: INACTIVE ❌</b>\n`;
    }
    
    const buttons = [
        [{ text: "📚 Manage Content", callback_data: "admin:menu:content" }],
        [{ text: "📝 Quiz Admin Panel", callback_data: "admin:menu:quiz_panel" }],
        [{ text: "👥 User Management", callback_data: "admin:menu:users" }],
        [{ text: "🔓 Unlock User by ID", callback_data: "admin:action:unlock_user" }]
    ];
    
    if (globalUnlock.enabled) {
        buttons.push([{ text: "🚫 Disable Global Unlock", callback_data: "admin:action:disable_global" }]);
    } else {
        buttons.push([{ text: "🌐 Enable Global Unlock (All Users)", callback_data: "admin:action:enable_global" }]);
    }
    
    buttons.push([{ text: "⚙️ Bot Settings", callback_data: "admin:menu:settings" }]);
    const promoButton = getPromotionalButton();
    if (promoButton) buttons.push([promoButton]);
    buttons.push([{ text: "⬅️ Back to Menu", callback_data: "back:main" }]);
    
    await sendTextMessage(message.chat.id, text, { reply_markup: { inline_keyboard: buttons } });
}

async function showRewardsHub(message, env) {
    const userId = message.from.id;
    
    const { results: pdfs } = await env.DB.prepare("SELECT * FROM pdfs WHERE is_referral_reward = 1").all();
    
    let text = `<b>🎁 Rewards Hub</b>\n\n`;
    text += `<b>Congratulations!</b> You've unlocked exclusive rewards for inviting ${REFERRAL_TARGET}+ friends!\n\n`;
    text += `<b>📚 Available Reward Books:</b>\n`;
    
    if (pdfs.length === 0) {
        text += `<i>No exclusive rewards are available at the moment. Check back later!</i>`;
    } else {
        text += `You have access to ${pdfs.length} exclusive books!\n\n`;
        text += `Tap the buttons below to download:`;
    }
    
    const buttons = pdfs.map(pdf => [{
        text: `📖 ${pdf.file_name}`,
        callback_data: `pdf:download:${pdf.id}`
    }]);
    
    const promoButton = getPromotionalButton();
    if (promoButton) buttons.push([promoButton]);
    buttons.push([{ text: "⬅️ Back to Menu", callback_data: "back:main" }]);
    
    await sendTextMessage(userId, text, { reply_markup: { inline_keyboard: buttons } });
}

async function isCalculationQuestion(questionText) {
    const calcKeywords = [
        'calculate', 'compute', 'find the value', 'solve', 'what is',
        'how much', 'how many', 'determine', 'evaluate', 'derivative',
        'integral', 'equation', 'formula', '+', '-', '×', '÷', '=',
        'x²', 'x³', '√', 'log', 'sin', 'cos', 'tan'
    ];
    
    const lowerText = questionText.toLowerCase();
    return calcKeywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

function parseQuizTextToQuestions(text) {
    const questions = [];
    const blocks = text.split(/\n\s*\n/);
    
    for (const block of blocks) {
        const lines = block.split('\n').filter(l => l.trim());
        if (lines.length < 6) continue;
        
        const q = {};
        let currentField = null;
        
        for (const line of lines) {
            if (line.match(/^Question:\s*/i)) {
                q.question = line.replace(/^Question:\s*/i, '').trim();
            } else if (line.match(/^A:\s*/i)) {
                q.options = q.options || {};
                q.options.A = line.replace(/^A:\s*/i, '').trim();
            } else if (line.match(/^B:\s*/i)) {
                q.options = q.options || {};
                q.options.B = line.replace(/^B:\s*/i, '').trim();
            } else if (line.match(/^C:\s*/i)) {
                q.options = q.options || {};
                q.options.C = line.replace(/^C:\s*/i, '').trim();
            } else if (line.match(/^D:\s*/i)) {
                q.options = q.options || {};
                q.options.D = line.replace(/^D:\s*/i, '').trim();
            } else if (line.match(/^Correct:\s*/i)) {
                q.correct = line.replace(/^Correct:\s*/i, '').trim().toUpperCase();
            } else if (line.match(/^Explanation:\s*/i)) {
                q.explanation = line.replace(/^Explanation:\s*/i, '').trim();
            }
        }
        
        if (q.question && q.options && q.correct && Object.keys(q.options).length === 4) {
            questions.push(q);
        }
    }
    
    return questions;
}

async function startQuizSession(cb, [quizId], env) {
    const userId = cb.from.id;
    const quiz = await env.DB.prepare("SELECT * FROM quizzes WHERE id = ?").bind(quizId).first();
    
    if (!quiz) {
        await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "❌ Quiz not found.", show_alert: true });
        return;
    }
    
    const isPremium = quiz.grade === "9" || quiz.grade === "10" || quiz.grade === "11" || quiz.grade === "12" || quiz.grade === "Entrance Exam";
    
    if (isPremium) {
        const isUnlocked = await isUserUnlocked(userId, env);
        if (!isUnlocked) {
            await apiRequest("answerCallbackQuery", { 
                callback_query_id: cb.id, 
                text: `🔒 This is a premium quiz. Invite ${REFERRAL_TARGET} friends to unlock!`, 
                show_alert: true 
            });
            return;
        }
    }
    
    let { results: questions } = await env.DB.prepare("SELECT * FROM questions WHERE quiz_id = ?").bind(quizId).all();
    
    if (quiz.shuffle_questions === 1) {
        questions = questions.sort(() => Math.random() - 0.5);
    }
    
    if (!questions.length) {
        await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "❌ No questions found in this quiz.", show_alert: true });
        return;
    }
    
    const sessionData = {
        quiz_id: quizId,
        quiz_name: quiz.name,
        questions: questions.map(q => q.id),
        current_index: 0,
        score: 0,
        start_time: Date.now(),
        message_id: cb.message.message_id
    };
    
    await setState(userId, "quiz_active", sessionData, env);
    await displayQuizQuestion(userId, cb.message.chat.id, sessionData, questions, env);
}

async function displayQuizQuestion(userId, chatId, sessionData, allQuestions, env) {
    const questionId = sessionData.questions[sessionData.current_index];
    const question = allQuestions.find(q => q.id === questionId);
    
    if (!question) {
        await endQuizSession(userId, chatId, sessionData, env);
        return;
    }
    
    const timeLimit = question.is_calculation === 1 ? 300 : 60;
    sessionData.question_start_time = Date.now();
    sessionData.time_limit = timeLimit;
    await setState(userId, "quiz_active", sessionData, env);
    
    const questionNum = sessionData.current_index + 1;
    const totalQuestions = sessionData.questions.length;
    
    let text = `<b>📝 ${sessionData.quiz_name}</b>\n\n`;
    text += `<b>Question ${questionNum}/${totalQuestions}</b>\n`;
    text += `⏱️ Time: <b>${timeLimit === 300 ? '5:00' : '1:00'}</b>\n\n`;
    text += `${question.question_text}\n\n`;
    text += `<b>A.</b> ${question.option_a}\n`;
    text += `<b>B.</b> ${question.option_b}\n`;
    text += `<b>C.</b> ${question.option_c}\n`;
    text += `<b>D.</b> ${question.option_d}`;
    
    const buttons = [
        [
            { text: "A", callback_data: `quiz:answer:A:${questionId}` },
            { text: "B", callback_data: `quiz:answer:B:${questionId}` }
        ],
        [
            { text: "C", callback_data: `quiz:answer:C:${questionId}` },
            { text: "D", callback_data: `quiz:answer:D:${questionId}` }
        ],
        [{ text: "❌ Exit Quiz", callback_data: "quiz:exit" }]
    ];
    
    await editMessageText(chatId, sessionData.message_id, text, { reply_markup: { inline_keyboard: buttons } });
    
    startQuizTimer(userId, chatId, sessionData, allQuestions, timeLimit, env);
}

async function startQuizTimer(userId, chatId, sessionData, allQuestions, timeLimit, env) {
    const interval = setInterval(async () => {
        const stateData = await getState(userId, env);
        if (!stateData || stateData.state !== "quiz_active") {
            clearInterval(interval);
            return;
        }
        
        const elapsed = Math.floor((Date.now() - sessionData.question_start_time) / 1000);
        const remaining = timeLimit - elapsed;
        
        if (remaining <= 0) {
            clearInterval(interval);
            await handleQuizTimeout(userId, chatId, sessionData, allQuestions, env);
            return;
        }
        
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        const questionId = sessionData.questions[sessionData.current_index];
        const question = allQuestions.find(q => q.id === questionId);
        
        const questionNum = sessionData.current_index + 1;
        const totalQuestions = sessionData.questions.length;
        
        let text = `<b>📝 ${sessionData.quiz_name}</b>\n\n`;
        text += `<b>Question ${questionNum}/${totalQuestions}</b>\n`;
        text += `⏱️ Time: <b>${timeText}</b>\n\n`;
        text += `${question.question_text}\n\n`;
        text += `<b>A.</b> ${question.option_a}\n`;
        text += `<b>B.</b> ${question.option_b}\n`;
        text += `<b>C.</b> ${question.option_c}\n`;
        text += `<b>D.</b> ${question.option_d}`;
        
        const buttons = [
            [
                { text: "A", callback_data: `quiz:answer:A:${questionId}` },
                { text: "B", callback_data: `quiz:answer:B:${questionId}` }
            ],
            [
                { text: "C", callback_data: `quiz:answer:C:${questionId}` },
                { text: "D", callback_data: `quiz:answer:D:${questionId}` }
            ],
            [{ text: "❌ Exit Quiz", callback_data: "quiz:exit" }]
        ];
        
        try {
            await editMessageText(chatId, sessionData.message_id, text, { reply_markup: { inline_keyboard: buttons } });
        } catch (e) {
            console.error("Timer update error:", e);
        }
    }, 1000);
}

async function handleQuizTimeout(userId, chatId, sessionData, allQuestions, env) {
    sessionData.current_index++;
    
    if (sessionData.current_index >= sessionData.questions.length) {
        await endQuizSession(userId, chatId, sessionData, env);
    } else {
        await setState(userId, "quiz_active", sessionData, env);
        await displayQuizQuestion(userId, chatId, sessionData, allQuestions, env);
    }
}

async function handleQuizAnswer(cb, [answer, questionId], env) {
    const userId = cb.from.id;
    const stateData = await getState(userId, env);
    
    if (!stateData || stateData.state !== "quiz_active") {
        await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "❌ No active quiz session.", show_alert: true });
        return;
    }
    
    const sessionData = stateData.data;
    const question = await env.DB.prepare("SELECT * FROM questions WHERE id = ?").bind(questionId).first();
    
    if (!question) {
        await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "❌ Question not found.", show_alert: true });
        return;
    }
    
    const isCorrect = answer.toUpperCase() === question.correct_option.toUpperCase();
    if (isCorrect) sessionData.score++;
    
    sessionData.current_index++;
    
    let feedbackText = isCorrect ? "✅ Correct!" : `❌ Wrong! Correct answer: ${question.correct_option}`;
    if (question.explanation) {
        feedbackText += `\n\n<b>Explanation:</b> ${question.explanation}`;
    }
    
    await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: isCorrect ? "✅ Correct!" : "❌ Wrong!", show_alert: false });
    
    if (sessionData.current_index >= sessionData.questions.length) {
        await endQuizSession(userId, cb.message.chat.id, sessionData, env);
    } else {
        const { results: allQuestions } = await env.DB.prepare("SELECT * FROM questions WHERE quiz_id = ?").bind(sessionData.quiz_id).all();
        await setState(userId, "quiz_active", sessionData, env);
        await displayQuizQuestion(userId, cb.message.chat.id, sessionData, allQuestions, env);
    }
}

async function endQuizSession(userId, chatId, sessionData, env) {
    const totalQuestions = sessionData.questions.length;
    const score = sessionData.score;
    const percentage = Math.round((score / totalQuestions) * 100);
    
    await env.DB.prepare("INSERT INTO quiz_sessions (user_id, quiz_id, score, total_questions, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)").bind(userId, sessionData.quiz_id, score, totalQuestions, new Date(sessionData.start_time).toISOString(), new Date().toISOString()).run();
    
    let emoji = percentage >= 80 ? "🏆" : percentage >= 60 ? "🎉" : percentage >= 40 ? "👍" : "📚";
    
    let text = `${emoji} <b>Quiz Completed!</b>\n\n`;
    text += `<b>${sessionData.quiz_name}</b>\n\n`;
    text += `<b>Your Score:</b> ${score}/${totalQuestions} (${percentage}%)\n`;
    
    if (percentage >= 80) {
        text += `\n🌟 Excellent work! You're mastering this topic!`;
    } else if (percentage >= 60) {
        text += `\n💪 Good job! Keep practicing to improve!`;
    } else if (percentage >= 40) {
        text += `\n📖 Not bad! Review the material and try again!`;
    } else {
        text += `\n🔄 Keep learning! Practice makes perfect!`;
    }
    
    const buttons = [
        [{ text: "🔄 Retake Quiz", callback_data: `quiz:start:${sessionData.quiz_id}` }],
        [{ text: "📚 Back to Content Hub", callback_data: "back:content_hub" }],
        [{ text: "⬅️ Main Menu", callback_data: "back:main" }]
    ];
    
    await editMessageText(chatId, sessionData.message_id, text, { reply_markup: { inline_keyboard: buttons } });
    await clearState(userId, env);
}

async function showLeaderboardGrades(message, env) {
    const { results: availableGrades } = await env.DB.prepare("SELECT DISTINCT grade FROM quizzes WHERE id IN (SELECT DISTINCT quiz_id FROM quiz_sessions)").all();
    
    if (!availableGrades.length) {
        await sendTextMessage(message.chat.id, "No leaderboards available yet. Complete some quizzes first!");
        return;
    }
    
    const gradeButtons = availableGrades.map(g => [{ text: `Grade ${g.grade}`, callback_data: `ldb:subjects:${g.grade}` }]);
    const promoButton = getPromotionalButton();
    if (promoButton) gradeButtons.push([promoButton]);
    gradeButtons.push([{ text: "⬅️ Back to Menu", callback_data: "back:main" }]);
    
    await sendTextMessage(message.chat.id, "<b>🏆 Leaderboards</b>\n\nSelect a grade to view top performers:", { reply_markup: { inline_keyboard: gradeButtons } });
}

async function showLeaderboardSubjects(cb, [grade], env) {
    const { results: subjects } = await env.DB.prepare("SELECT s.id, s.name FROM subjects s JOIN quizzes q ON s.id = q.subject_id WHERE q.grade = ? AND q.id IN (SELECT DISTINCT quiz_id FROM quiz_sessions) GROUP BY s.id").bind(grade).all();
    
    if (!subjects.length) {
        const markup = { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "ldb:grades" }]] };
        await editMessageText(cb.message.chat.id, cb.message.message_id, `No leaderboards for Grade ${grade}.`, { reply_markup: markup });
        return;
    }
    
    const subjectButtons = subjects.map(s => [{ text: s.name, callback_data: `ldb:list:${grade}:${s.id}` }]);
    const promoButton = getPromotionalButton();
    if (promoButton) subjectButtons.push([promoButton]);
    subjectButtons.push([{ text: "⬅️ Back", callback_data: "ldb:grades" }]);
    
    await editMessageText(cb.message.chat.id, cb.message.message_id, `<b>Grade ${grade}</b>\n\nSelect a subject:`, { reply_markup: { inline_keyboard: subjectButtons } });
}

async function showLeaderboardList(cb, [grade, subjectId], env) {
    const { results: quizzes } = await env.DB.prepare("SELECT id, name FROM quizzes WHERE grade = ? AND subject_id = ? AND id IN (SELECT DISTINCT quiz_id FROM quiz_sessions)").bind(grade, subjectId).all();
    
    if (!quizzes.length) {
        const markup = { inline_keyboard: [[{ text: "⬅️ Back", callback_data: `ldb:subjects:${grade}` }]] };
        await editMessageText(cb.message.chat.id, cb.message.message_id, `No leaderboards found.`, { reply_markup: markup });
        return;
    }
    
    const quizButtons = quizzes.map(q => [{ text: q.name, callback_data: `ldb:view:${q.id}:${grade}:${subjectId}` }]);
    const promoButton = getPromotionalButton();
    if (promoButton) quizButtons.push([promoButton]);
    quizButtons.push([{ text: "⬅️ Back", callback_data: `ldb:subjects:${grade}` }]);
    
    await editMessageText(cb.message.chat.id, cb.message.message_id, "Select a quiz to see Top 10:", { reply_markup: { inline_keyboard: quizButtons } });
}

async function displayLeaderboard(cb, [quizId, grade, subjectId], env) {
    const quiz = await env.DB.prepare("SELECT name FROM quizzes WHERE id = ?").bind(quizId).first();
    const { results: topScores } = await env.DB.prepare("SELECT u.first_name, MAX(qs.score) as high_score, qs.total_questions FROM quiz_sessions qs JOIN users u ON qs.user_id = u.user_id WHERE qs.quiz_id = ? GROUP BY qs.user_id ORDER BY high_score DESC, qs.end_time ASC LIMIT 10").bind(quizId).all();
    
    let text = `<b>🏆 Leaderboard: ${quiz.name}</b>\n\n`;
    
    if (!topScores.length) {
        text += "<i>No scores yet. Be the first to complete this quiz!</i>";
    } else {
        const medals = ["🥇", "🥈", "🥉"];
        text += topScores.map((e, i) => `${medals[i] || `<b>${i + 1}.</b>`} ${e.first_name.replace(/</g, "&lt;")} - <b>${e.high_score}/${e.total_questions}</b>`).join("\n");
    }
    
    const promoButton = getPromotionalButton();
    const buttons = [];
    if (promoButton) buttons.push([promoButton]);
    buttons.push([{ text: "⬅️ Back", callback_data: `ldb:list:${grade}:${subjectId}` }]);
    
    await editMessageText(cb.message.chat.id, cb.message.message_id, text, { reply_markup: { inline_keyboard: buttons } });
}

async function handleInvite(message, env) {
    const userId = message.from.id;
    
    if (!botUsername) {
        await sendTextMessage(userId, "⚠️ Could not generate invite link. Please try again in a moment.");
        return;
    }
    
    const referralLink = `https://t.me/${botUsername}?start=${userId}`;
    const { results: [refCount] } = await env.DB.prepare("SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?").bind(userId).run();
    const remaining = Math.max(0, REFERRAL_TARGET - refCount.count);
    
    let text = `<b>📢 Invite & Earn</b>\n\nInvite friends to unlock premium AI models and exclusive reward books!\n\n`;
    text += `<b>📊 Your Progress:</b> ${refCount.count} / ${REFERRAL_TARGET} invites\n`;
    
    if (remaining > 0) {
        text += `\n🎯 You need <b>${remaining} more</b> ${remaining === 1 ? 'invite' : 'invites'} to unlock all rewards!\n\n`;
    } else {
        text += `\n🎉 <b>Congratulations! You've unlocked all rewards!</b>\n\n`;
    }
    
    text += `<b>📎 Your Referral Link:</b>\n<pre>${referralLink}</pre>\n\nShare this link with friends to earn rewards! 🚀`;
    
    const promoButton = getPromotionalButton();
    const buttons = [];
    if (promoButton) buttons.push([promoButton]);
    buttons.push([{ text: "⬅️ Back to Menu", callback_data: "back:main" }]);
    
    await sendTextMessage(userId, text, { reply_markup: { inline_keyboard: buttons } });
}

const STATE_HANDLERS = {
    admin_add_subject_name: async (message, data, env) => {
        const subjectName = message.text.trim();
        if (!subjectName) {
            await sendTextMessage(message.chat.id, "❌ Subject name cannot be empty.");
            return;
        }
        
        try {
            await env.DB.prepare("INSERT INTO subjects (name) VALUES (?)").bind(subjectName).run();
            await sendTextMessage(message.chat.id, `✅ Subject "<b>${subjectName}</b>" added successfully!`);
            await clearState(message.from.id, env);
        } catch (e) {
            await sendTextMessage(message.chat.id, `❌ Error adding subject: ${e.message}`);
        }
    },
    
    admin_quiz_select_grade: async (message, data, env) => {
        const grade = message.text.trim();
        if (!GRADES.includes(grade)) {
            await sendTextMessage(message.chat.id, `❌ Invalid grade. Please choose from:\n${GRADES.join(", ")}`);
            return;
        }
        
        data.grade = grade;
        await setState(message.from.id, "admin_quiz_select_subject", data, env);
        
        const { results: subjects } = await env.DB.prepare("SELECT id, name FROM subjects").all();
        const subjectList = subjects.map(s => `${s.id}. ${s.name}`).join("\n");
        
        const markup = {
            inline_keyboard: [[{ text: "❌ Cancel", callback_data: "admin_cancel:upload" }]]
        };
        
        await sendTextMessage(message.chat.id, `<b>Grade selected:</b> ${grade}\n\nNow, enter the subject ID:\n\n${subjectList}`, { reply_markup: markup });
    },
    
    admin_quiz_select_subject: async (message, data, env) => {
        const subjectId = parseInt(message.text.trim());
        if (isNaN(subjectId)) {
            await sendTextMessage(message.chat.id, "❌ Please enter a valid subject ID number.");
            return;
        }
        
        data.subjectId = subjectId;
        await setState(message.from.id, "admin_quiz_enter_name", data, env);
        
        const markup = {
            inline_keyboard: [[{ text: "❌ Cancel", callback_data: "admin_cancel:upload" }]]
        };
        
        await sendTextMessage(message.chat.id, "Enter a name for this quiz:", { reply_markup: markup });
    },
    
    admin_quiz_enter_name: async (message, data, env) => {
        const quizName = message.text.trim();
        if (!quizName) {
            await sendTextMessage(message.chat.id, "❌ Quiz name cannot be empty.");
            return;
        }
        
        data.quizName = quizName;
        
        if (data.grade === "12" || data.grade === "Entrance Exam") {
            await setState(message.from.id, "admin_quiz_shuffle_option", data, env);
            const markup = {
                inline_keyboard: [
                    [{ text: "Yes, Shuffle Questions ✓", callback_data: "admin_shuffle:yes" }],
                    [{ text: "No, Keep Original Order", callback_data: "admin_shuffle:no" }],
                    [{ text: "❌ Cancel", callback_data: "admin_cancel:upload" }]
                ]
            };
            await sendTextMessage(message.chat.id, "Should the questions be shuffled for each student?", { reply_markup: markup });
        } else {
            data.shuffle = false;
            await setState(message.from.id, "admin_quiz_upload_txt", data, env);
            
            const markup = {
                inline_keyboard: [[{ text: "❌ Cancel", callback_data: "admin_cancel:upload" }]]
            };
            
            await sendTextMessage(message.chat.id, "Now, upload the quiz .txt file.\n\n<b>Format:</b>\nQuestion: ...\nA: ...\nB: ...\nC: ...\nD: ...\nCorrect: A\nExplanation: ...", { reply_markup: markup });
        }
    },
    
    admin_quiz_upload_txt: async (message, data, env) => {
        if (!message.document || !message.document.file_name.endsWith(".txt")) {
            await sendTextMessage(message.chat.id, "❌ Please upload a valid .txt file.");
            return;
        }
        
        const thinkingMsg = await sendTextMessage(message.chat.id, "⏳ Processing your quiz file...");
        
        try {
            const file = await apiRequestWithRetry("getFile", { file_id: message.document.file_id });
            if (!file.ok) throw new Error("Could not get file info.");
            
            const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.result.file_path}`;
            const fileResponse = await fetch(fileUrl);
            const fileContent = await fileResponse.text();
            
            const questions = parseQuizTextToQuestions(fileContent);
            if (!questions || questions.length === 0) {
                throw new Error("Could not parse questions. Please check the format.");
            }
            
            await editMessageText(message.chat.id, thinkingMsg.result.message_id, `✅ Parsed ${questions.length} questions! Analyzing each for calculation requirement...`);
            
            for (let i = 0; i < questions.length; i++) {
                questions[i].is_calculation = await isCalculationQuestion(questions[i].question);
                
                if ((i + 1) % 10 === 0 || i === questions.length - 1) {
                    await editMessageText(message.chat.id, thinkingMsg.result.message_id, `✅ Parsed ${questions.length} questions!\n\n📊 Analyzing... ${i + 1}/${questions.length}`);
                }
            }
            
            const { meta } = await env.DB.prepare("INSERT INTO quizzes (name, grade, subject_id, shuffle_questions) VALUES (?, ?, ?, ?)").bind(data.quizName, data.grade, data.subjectId, data.shuffle ? 1 : 0).run();
            
            const quizId = meta.last_row_id;
            const stmts = questions.map((q) => env.DB.prepare("INSERT INTO questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, is_calculation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(quizId, q.question, q.options.A, q.options.B, q.options.C, q.options.D, q.correct, q.explanation, q.is_calculation ? 1 : 0));
            
            await env.DB.batch(stmts);
            
            await editMessageText(message.chat.id, thinkingMsg.result.message_id, `✅ <b>Success!</b>\n\nQuiz '<b>${data.quizName}</b>' created with ${questions.length} questions!`);
            await clearState(message.from.id, env);
        } catch (e) {
            console.error("Quiz upload error:", e);
            await editMessageText(message.chat.id, thinkingMsg.result.message_id, `❌ <b>Error:</b> ${e.message}`);
        }
    },
    
    admin_pdf_select_grade: async (message, data, env) => {
        const grade = message.text.trim();
        if (!GRADES.includes(grade)) {
            await sendTextMessage(message.chat.id, `❌ Invalid grade. Please choose from:\n${GRADES.join(", ")}`);
            return;
        }
        
        data.grade = grade;
        await setState(message.from.id, "admin_pdf_select_subject", data, env);
        
        const { results: subjects } = await env.DB.prepare("SELECT id, name FROM subjects").all();
        const subjectList = subjects.map(s => `${s.id}. ${s.name}`).join("\n");
        
        const markup = {
            inline_keyboard: [[{ text: "❌ Cancel", callback_data: "admin_cancel:upload" }]]
        };
        
        await sendTextMessage(message.chat.id, `<b>Grade selected:</b> ${grade}\n\nNow, enter the subject ID:\n\n${subjectList}`, { reply_markup: markup });
    },
    
    admin_pdf_select_subject: async (message, data, env) => {
        const subjectId = parseInt(message.text.trim());
        if (isNaN(subjectId)) {
            await sendTextMessage(message.chat.id, "❌ Please enter a valid subject ID number.");
            return;
        }
        
        data.subjectId = subjectId;
        await setState(message.from.id, "admin_pdf_reward_choice", data, env);
        
        const markup = {
            inline_keyboard: [
                [{ text: "📄 Regular PDF (Everyone)", callback_data: "admin_pdf_type:regular" }],
                [{ text: "🎁 Exclusive Reward (10+ Referrals)", callback_data: "admin_pdf_type:reward" }],
                [{ text: "❌ Cancel", callback_data: "admin_cancel:upload" }]
            ]
        };
        
        await sendTextMessage(message.chat.id, "Is this PDF a regular file or an exclusive Referral Reward?", { reply_markup: markup });
    },
    
    admin_pdf_upload_file: async (message, data, env) => {
        if (!message.document) {
            await sendTextMessage(message.chat.id, "❌ Please upload a PDF file.");
            return;
        }
        
        try {
            const fileName = message.document.file_name;
            const fileId = message.document.file_id;
            
            await env.DB.prepare("INSERT INTO pdfs (file_name, file_id, grade, subject_id, is_referral_reward) VALUES (?, ?, ?, ?, ?)").bind(fileName, fileId, data.grade, data.subjectId, data.isReward ? 1 : 0).run();
            
            await sendTextMessage(message.chat.id, `✅ PDF "<b>${fileName}</b>" uploaded successfully!`);
            await clearState(message.from.id, env);
        } catch (e) {
            await sendTextMessage(message.chat.id, `❌ Error uploading PDF: ${e.message}`);
        }
    },
    
    admin_ban_user_id: async (message, data, env) => {
        const targetId = parseInt(message.text.trim());
        if (isNaN(targetId)) {
            await sendTextMessage(message.chat.id, "❌ Please enter a valid user ID number.");
            return;
        }
        
        try {
            await env.DB.prepare("UPDATE users SET is_banned = 1 WHERE user_id = ?").bind(targetId).run();
            await sendTextMessage(message.chat.id, `✅ User ${targetId} has been banned.`);
            await clearState(message.from.id, env);
        } catch (e) {
            await sendTextMessage(message.chat.id, `❌ Error: ${e.message}`);
        }
    },
    
    admin_unban_user_id: async (message, data, env) => {
        const targetId = parseInt(message.text.trim());
        if (isNaN(targetId)) {
            await sendTextMessage(message.chat.id, "❌ Please enter a valid user ID number.");
            return;
        }
        
        try {
            await env.DB.prepare("UPDATE users SET is_banned = 0 WHERE user_id = ?").bind(targetId).run();
            await sendTextMessage(message.chat.id, `✅ User ${targetId} has been unbanned.`);
            await clearState(message.from.id, env);
        } catch (e) {
            await sendTextMessage(message.chat.id, `❌ Error: ${e.message}`);
        }
    },
    
    admin_unlock_user_id: async (message, data, env) => {
        const targetId = parseInt(message.text.trim());
        if (isNaN(targetId)) {
            await sendTextMessage(message.chat.id, "❌ Please enter a valid user ID number.");
            return;
        }
        
        try {
            const user = await env.DB.prepare("SELECT user_id, first_name FROM users WHERE user_id = ?").bind(targetId).first();
            
            if (!user) {
                await sendTextMessage(message.chat.id, `❌ User ${targetId} not found in database.`);
                return;
            }
            
            await env.DB.prepare("UPDATE users SET is_manually_unlocked = 1 WHERE user_id = ?").bind(targetId).run();
            await sendTextMessage(message.chat.id, `✅ <b>Success!</b>\n\nUser <b>${user.first_name}</b> (ID: ${targetId}) has been manually unlocked!\n\nThey now have full access to all premium quizzes and PDFs. 🎉`);
            
            try {
                await sendTextMessage(targetId, `🎉 <b>Congratulations!</b>\n\nYou've been granted <b>Premium Access</b> by an administrator!\n\nYou now have full access to all quizzes and study materials. Enjoy! 🚀`);
            } catch (e) {
                console.error("Could not notify user:", e);
            }
            
            await clearState(message.from.id, env);
        } catch (e) {
            await sendTextMessage(message.chat.id, `❌ Error: ${e.message}`);
        }
    },
    
    admin_change_promo_url: async (message, data, env) => {
        const newUrl = message.text.trim();
        if (!newUrl.startsWith("https://t.me/")) {
            await sendTextMessage(message.chat.id, "❌ Please enter a valid Telegram link (https://t.me/...)");
            return;
        }
        
        try {
            await env.DB.prepare("UPDATE bot_config SET value = ? WHERE key = 'promo_channel_url'").bind(newUrl).run();
            BOT_CONFIG_CACHE = null;
            await loadBotConfig(env);
            await sendTextMessage(message.chat.id, `✅ Promotional URL updated to:\n${newUrl}`);
            await clearState(message.from.id, env);
        } catch (e) {
            await sendTextMessage(message.chat.id, `❌ Error: ${e.message}`);
        }
    },
    
    admin_change_promo_text: async (message, data, env) => {
        const newText = message.text.trim();
        if (!newText) {
            await sendTextMessage(message.chat.id, "❌ Button text cannot be empty.");
            return;
        }
        
        try {
            await env.DB.prepare("UPDATE bot_config SET value = ? WHERE key = 'promo_channel_text'").bind(newText).run();
            BOT_CONFIG_CACHE = null;
            await loadBotConfig(env);
            await sendTextMessage(message.chat.id, `✅ Promotional button text updated to: "${newText}"`);
            await clearState(message.from.id, env);
        } catch (e) {
            await sendTextMessage(message.chat.id, `❌ Error: ${e.message}`);
        }
    }
};

const CALLBACK_HANDLERS = {
    back: async (cb, args, env) => {
        const [target] = args;
        
        if (target === "main") {
            await showMainMenu({ from: cb.from }, env);
        } else if (target === "content_hub") {
            await showContentHub({ from: cb.from, chat: cb.message.chat }, env);
        }
    },
    
    ai: async (cb, args, env) => {
        const [action, aiKey] = args;
        const userId = cb.from.id;
        const isAdmin = ADMIN_IDS.includes(userId);
        
        if (action === "select") {
            const { results: [refCount] } = await env.DB.prepare("SELECT count(*) as count FROM referrals WHERE referrer_id = ?").bind(userId).run();
            const hasPremium = isAdmin || refCount.count >= REFERRAL_TARGET;
            
            const config = AVAILABLE_AIS[aiKey];
            if (!config) {
                await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "❌ AI model not found.", show_alert: true });
                return;
            }
            
            if (config.is_premium && !hasPremium) {
                const message = isAdmin ? "This premium AI is available to you as an admin!" : `🔒 This is a premium AI. Invite ${REFERRAL_TARGET} friends to unlock!`;
                await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: message, show_alert: true });
                return;
            }
            
            await env.DB.prepare("UPDATE user_settings SET selected_ai = ? WHERE user_id = ?").bind(aiKey, userId).run();
            await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: `✅ Switched to ${config.name}!` });
            await showAiMenu({ from: cb.from }, env);
        }
    },
    
    settings: async (cb, args, env) => {
        const [action] = args;
        const userId = cb.from.id;
        
        if (action === "toggle_stt") {
            const settings = await env.DB.prepare("SELECT stt_enabled FROM user_settings WHERE user_id = ?").bind(userId).first();
            const newMode = settings?.stt_enabled === 1 ? 0 : 1;
            
            await env.DB.prepare("UPDATE user_settings SET stt_enabled = ? WHERE user_id = ?").bind(newMode, userId).run();
            await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: `🎙️ Speech-to-Text ${newMode === 1 ? "ON ✅" : "OFF ❌"}` });
            await showSettings({ from: cb.from, chat: cb.message.chat }, env);
        } else if (action === "toggle_tts") {
            const settings = await env.DB.prepare("SELECT tts_enabled FROM user_settings WHERE user_id = ?").bind(userId).first();
            const newMode = settings?.tts_enabled === 1 ? 0 : 1;
            
            await env.DB.prepare("UPDATE user_settings SET tts_enabled = ? WHERE user_id = ?").bind(newMode, userId).run();
            await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: `🔊 Text-to-Speech ${newMode === 1 ? "ON ✅" : "OFF ❌"}` });
            await showSettings({ from: cb.from, chat: cb.message.chat }, env);
        } else if (action === "clear_memory") {
            await env.KV.delete(`history:${userId}`);
            await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "✅ Conversation memory cleared!" });
        } else if (action === "about") {
            const aboutText = `<b>ℹ️ About This Bot</b>\n\n<b>🤖 Version:</b> 4.0 (Enhanced Edition)\n<b>👨‍💻 Developer:</b> BK the Hawk𓅓\n\n<b>✨ Features:</b>\n• AI-powered conversations (4 AI models)\n• Interactive quizzes with live timers\n• Educational PDFs and study materials\n• Voice-to-Text (STT) & Text-to-Voice (TTS)\n• Referral rewards system\n• Admin management panel\n• Global unlock system\n\n<b>🔗 Powered by:</b>\nCloudflare Workers + D1 + KV`;
            await editMessageText(cb.message.chat.id, cb.message.message_id, aboutText, { reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "back:main" }]] } });
        }
    },
    
    admin: async (cb, args, env) => {
        if (!ADMIN_IDS.includes(cb.from.id)) {
            await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "❌ Unauthorized", show_alert: true });
            return;
        }
        
        const [section, subsection] = args;
        
        if (section === "main") {
            await showSuperAdminPanel({ from: cb.from, chat: cb.message.chat }, env);
        } else if (section === "menu") {
            if (subsection === "content") {
                const buttons = [
                    [{ text: "➕ Add Subject", callback_data: "admin:action:add_subject" }],
                    [{ text: "📋 Upload Quiz (.txt)", callback_data: "admin:action:upload_quiz" }],
                    [{ text: "📄 Upload PDF", callback_data: "admin:action:upload_pdf" }]
                ];
                const promoButton = getPromotionalButton();
                if (promoButton) buttons.push([promoButton]);
                buttons.push([{ text: "⬅️ Back", callback_data: "admin:main" }]);
                
                await editMessageText(cb.message.chat.id, cb.message.message_id, "<b>📚 Manage Content</b>\n\nAdd subjects, quizzes, and PDFs:", { reply_markup: { inline_keyboard: buttons } });
            } else if (subsection === "quiz_panel") {
                const { results: quizzes } = await env.DB.prepare("SELECT id, name, grade FROM quizzes ORDER BY grade, name LIMIT 20").all();
                const { results: [quizStats] } = await env.DB.prepare("SELECT COUNT(*) as total_quizzes, SUM((SELECT COUNT(*) FROM questions WHERE quiz_id = quizzes.id)) as total_questions FROM quizzes").run();
                
                let text = "<b>📝 Quiz Admin Panel</b>\n\n";
                text += `<b>📊 Statistics:</b>\n`;
                text += `• Total Quizzes: ${quizStats.total_quizzes || 0}\n`;
                text += `• Total Questions: ${quizStats.total_questions || 0}\n\n`;
                
                if (quizzes.length > 0) {
                    text += "<b>📋 Recent Quizzes:</b>\n";
                    quizzes.forEach((q, i) => {
                        text += `${i + 1}. ${q.name} (Grade ${q.grade})\n`;
                    });
                } else {
                    text += "<i>No quizzes created yet.</i>";
                }
                
                const buttons = [
                    [{ text: "📊 View Detailed Stats", callback_data: "admin:quiz_stats:detailed" }],
                    [{ text: "🗑️ Delete Quiz", callback_data: "admin:action:delete_quiz" }]
                ];
                const promoButton = getPromotionalButton();
                if (promoButton) buttons.push([promoButton]);
                buttons.push([{ text: "⬅️ Back", callback_data: "admin:main" }]);
                
                await editMessageText(cb.message.chat.id, cb.message.message_id, text, { reply_markup: { inline_keyboard: buttons } });
            } else if (subsection === "users") {
                const buttons = [
                    [{ text: "🚫 Ban User", callback_data: "admin:action:ban_user" }],
                    [{ text: "✅ Unban User", callback_data: "admin:action:unban_user" }],
                    [{ text: "📊 User Statistics", callback_data: "admin:stats:users" }]
                ];
                const promoButton = getPromotionalButton();
                if (promoButton) buttons.push([promoButton]);
                buttons.push([{ text: "⬅️ Back", callback_data: "admin:main" }]);
                
                await editMessageText(cb.message.chat.id, cb.message.message_id, "<b>👥 User Management</b>\n\nManage bot users:", { reply_markup: { inline_keyboard: buttons } });
            } else if (subsection === "settings") {
                const buttons = [
                    [{ text: "🔗 Change Promo URL", callback_data: "admin:action:change_url" }],
                    [{ text: "✏️ Change Promo Text", callback_data: "admin:action:change_text" }]
                ];
                const promoButton = getPromotionalButton();
                if (promoButton) buttons.push([promoButton]);
                buttons.push([{ text: "⬅️ Back", callback_data: "admin:main" }]);
                
                await editMessageText(cb.message.chat.id, cb.message.message_id, "<b>⚙️ Bot Settings</b>\n\nConfigure bot parameters:", { reply_markup: { inline_keyboard: buttons } });
            }
        } else if (section === "action") {
            if (subsection === "add_subject") {
                await setState(cb.from.id, "admin_add_subject_name", {}, env);
                await sendTextMessage(cb.message.chat.id, "Enter the name of the new subject:");
            } else if (subsection === "upload_quiz") {
                await setState(cb.from.id, "admin_quiz_select_grade", {}, env);
                await sendTextMessage(cb.message.chat.id, `<b>Upload Quiz</b>\n\nFirst, select a grade:\n${GRADES.join(", ")}`);
            } else if (subsection === "upload_pdf") {
                await setState(cb.from.id, "admin_pdf_select_grade", {}, env);
                await sendTextMessage(cb.message.chat.id, `<b>Upload PDF</b>\n\nFirst, select a grade:\n${GRADES.join(", ")}`);
            } else if (subsection === "ban_user") {
                await setState(cb.from.id, "admin_ban_user_id", {}, env);
                await sendTextMessage(cb.message.chat.id, "Enter the user ID to ban:");
            } else if (subsection === "unban_user") {
                await setState(cb.from.id, "admin_unban_user_id", {}, env);
                await sendTextMessage(cb.message.chat.id, "Enter the user ID to unban:");
            } else if (subsection === "unlock_user") {
                await setState(cb.from.id, "admin_unlock_user_id", {}, env);
                await sendTextMessage(cb.message.chat.id, "<b>🔓 Unlock User by ID</b>\n\nEnter the user ID to unlock premium access:\n\n<i>This will grant full access to all quizzes and PDFs.</i>");
            } else if (subsection === "enable_global") {
                try {
                    await setGlobalUnlock(true, GLOBAL_UNLOCK_DEFAULT_DAYS, env);
                    await apiRequest("answerCallbackQuery", { 
                        callback_query_id: cb.id, 
                        text: `✅ Global unlock enabled for ${GLOBAL_UNLOCK_DEFAULT_DAYS} days!`, 
                        show_alert: true 
                    });
                    await showSuperAdminPanel({ from: cb.from, chat: cb.message.chat }, env);
                } catch (e) {
                    await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: `❌ Error: ${e.message}`, show_alert: true });
                }
            } else if (subsection === "disable_global") {
                try {
                    await setGlobalUnlock(false, 0, env);
                    await apiRequest("answerCallbackQuery", { 
                        callback_query_id: cb.id, 
                        text: "✅ Global unlock disabled!", 
                        show_alert: true 
                    });
                    await showSuperAdminPanel({ from: cb.from, chat: cb.message.chat }, env);
                } catch (e) {
                    await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: `❌ Error: ${e.message}`, show_alert: true });
                }
            } else if (subsection === "change_url") {
                await setState(cb.from.id, "admin_change_promo_url", {}, env);
                await sendTextMessage(cb.message.chat.id, "Enter the new promotional channel URL (must start with https://t.me/):");
            } else if (subsection === "change_text") {
                await setState(cb.from.id, "admin_change_promo_text", {}, env);
                await sendTextMessage(cb.message.chat.id, "Enter the new promotional button text:");
            }
        }
    },
    
    admin_shuffle: async (cb, [choice], env) => {
        const stateData = await getState(cb.from.id, env);
        if (!stateData || stateData.state !== "admin_quiz_shuffle_option") {
            await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "❌ Session expired.", show_alert: true });
            return;
        }
        
        const data = stateData.data;
        data.shuffle = choice === "yes";
        await setState(cb.from.id, "admin_quiz_upload_txt", data, env);
        
        const markup = {
            inline_keyboard: [[{ text: "❌ Cancel", callback_data: "admin_cancel:upload" }]]
        };
        
        await sendTextMessage(cb.message.chat.id, "Now, upload the quiz .txt file.\n\n<b>Format:</b>\nQuestion: ...\nA: ...\nB: ...\nC: ...\nD: ...\nCorrect: A\nExplanation: ...", { reply_markup: markup });
    },
    
    admin_pdf_type: async (cb, [type], env) => {
        const stateData = await getState(cb.from.id, env);
        if (!stateData || stateData.state !== "admin_pdf_reward_choice") {
            await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "❌ Session expired.", show_alert: true });
            return;
        }
        
        const data = stateData.data;
        data.isReward = type === "reward";
        await setState(cb.from.id, "admin_pdf_upload_file", data, env);
        
        const markup = {
            inline_keyboard: [[{ text: "❌ Cancel", callback_data: "admin_cancel:upload" }]]
        };
        
        await sendTextMessage(cb.message.chat.id, "Now, upload the PDF file:", { reply_markup: markup });
    },
    
    admin_cancel: async (cb, [action], env) => {
        if (!ADMIN_IDS.includes(cb.from.id)) {
            await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "❌ Unauthorized", show_alert: true });
            return;
        }
        
        await clearState(cb.from.id, env);
        await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "✅ Upload cancelled" });
        await showSuperAdminPanel({ from: cb.from, chat: cb.message.chat }, env);
    },
    
    content: async (cb, args, env) => {
        const [action, value] = args;
        
        if (action === "grade") {
            const { results: subjects } = await env.DB.prepare("SELECT DISTINCT s.id, s.name FROM subjects s JOIN quizzes q ON s.id = q.subject_id WHERE q.grade = ?").bind(value).all();
            
            if (!subjects.length) {
                await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "No content available for this grade yet.", show_alert: true });
                return;
            }
            
            const buttons = subjects.map(s => [{ text: s.name, callback_data: `content:subject:${value}:${s.id}` }]);
            const promoButton = getPromotionalButton();
            if (promoButton) buttons.push([promoButton]);
            buttons.push([{ text: "⬅️ Back", callback_data: "back:content_hub" }]);
            
            await editMessageText(cb.message.chat.id, cb.message.message_id, `<b>Grade ${value}</b>\n\nSelect a subject:`, { reply_markup: { inline_keyboard: buttons } });
        } else if (action === "subject") {
            const [grade, subjectId] = value.split(":");
            
            const { results: quizzes } = await env.DB.prepare("SELECT id, name FROM quizzes WHERE grade = ? AND subject_id = ?").bind(grade, subjectId).all();
            const { results: pdfs } = await env.DB.prepare("SELECT id, file_name FROM pdfs WHERE grade = ? AND subject_id = ? AND is_referral_reward = 0").bind(grade, subjectId).all();
            
            const buttons = [];
            
            if (quizzes.length > 0) {
                buttons.push([{ text: "📝 Quizzes", callback_data: `content:list_quizzes:${grade}:${subjectId}` }]);
            }
            
            if (pdfs.length > 0) {
                buttons.push([{ text: "📄 Study Materials", callback_data: `content:list_pdfs:${grade}:${subjectId}` }]);
            }
            
            if (buttons.length === 0) {
                await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "No content available yet.", show_alert: true });
                return;
            }
            
            const promoButton = getPromotionalButton();
            if (promoButton) buttons.push([promoButton]);
            buttons.push([{ text: "⬅️ Back", callback_data: `content:grade:${grade}` }]);
            
            await editMessageText(cb.message.chat.id, cb.message.message_id, "<b>Content Type</b>\n\nWhat would you like to access?", { reply_markup: { inline_keyboard: buttons } });
        } else if (action === "list_quizzes") {
            const [grade, subjectId] = value.split(":");
            const { results: quizzes } = await env.DB.prepare("SELECT id, name FROM quizzes WHERE grade = ? AND subject_id = ?").bind(grade, subjectId).all();
            
            const buttons = quizzes.map(q => [{ text: q.name, callback_data: `quiz:start:${q.id}` }]);
            const promoButton = getPromotionalButton();
            if (promoButton) buttons.push([promoButton]);
            buttons.push([{ text: "⬅️ Back", callback_data: `content:subject:${grade}:${subjectId}` }]);
            
            await editMessageText(cb.message.chat.id, cb.message.message_id, "<b>📝 Available Quizzes</b>\n\nSelect a quiz to begin:", { reply_markup: { inline_keyboard: buttons } });
        } else if (action === "list_pdfs") {
            const [grade, subjectId] = value.split(":");
            const { results: pdfs } = await env.DB.prepare("SELECT id, file_name FROM pdfs WHERE grade = ? AND subject_id = ? AND is_referral_reward = 0").bind(grade, subjectId).all();
            
            const buttons = pdfs.map(p => [{ text: `📄 ${p.file_name}`, callback_data: `pdf:download:${p.id}` }]);
            const promoButton = getPromotionalButton();
            if (promoButton) buttons.push([promoButton]);
            buttons.push([{ text: "⬅️ Back", callback_data: `content:subject:${grade}:${subjectId}` }]);
            
            await editMessageText(cb.message.chat.id, cb.message.message_id, "<b>📄 Study Materials</b>\n\nSelect a PDF to download:", { reply_markup: { inline_keyboard: buttons } });
        }
    },
    
    quiz: async (cb, args, env) => {
        const [action, ...params] = args;
        
        if (action === "start") {
            await startQuizSession(cb, params, env);
        } else if (action === "answer") {
            await handleQuizAnswer(cb, params, env);
        } else if (action === "exit") {
            await clearState(cb.from.id, env);
            await editMessageText(cb.message.chat.id, cb.message.message_id, "❌ Quiz exited. You can start a new quiz anytime!", { reply_markup: { inline_keyboard: [[{ text: "⬅️ Main Menu", callback_data: "back:main" }]] } });
        }
    },
    
    pdf: async (cb, args, env) => {
        const [action, pdfId] = args;
        
        if (action === "download") {
            const pdf = await env.DB.prepare("SELECT * FROM pdfs WHERE id = ?").bind(pdfId).first();
            
            if (!pdf) {
                await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "❌ PDF not found.", show_alert: true });
                return;
            }
            
            if (pdf.is_referral_reward === 1) {
                const isUnlocked = await isUserUnlocked(cb.from.id, env);
                if (!isUnlocked) {
                    await apiRequest("answerCallbackQuery", { 
                        callback_query_id: cb.id, 
                        text: `🔒 This is a reward PDF. Invite ${REFERRAL_TARGET} friends to unlock!`, 
                        show_alert: true 
                    });
                    return;
                }
            }
            
            await apiRequest("sendDocument", {
                chat_id: cb.message.chat.id,
                document: pdf.file_id,
                caption: `📄 <b>${pdf.file_name}</b>\n\nGrade ${pdf.grade}${BOT_DEVELOPER_SIGNATURE}`
            });
            
            await apiRequest("answerCallbackQuery", { callback_query_id: cb.id, text: "✅ Sending PDF..." });
        }
    },
    
    ldb: async (cb, args, env) => {
        const [action, ...params] = args;
        
        if (action === "grades") {
            await showLeaderboardGrades({ chat: cb.message.chat }, env);
        } else if (action === "subjects") {
            await showLeaderboardSubjects(cb, params, env);
        } else if (action === "list") {
            await showLeaderboardList(cb, params, env);
        } else if (action === "view") {
            await displayLeaderboard(cb, params, env);
        }
    }
};
