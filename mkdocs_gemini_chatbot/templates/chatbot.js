document.addEventListener('DOMContentLoaded', () => {
    const chatbot = document.getElementById('gemini-chatbot');
    const openChatBtn = document.getElementById('open-chat');
    const closeChatBtn = document.getElementById('close-chat');
    const sendBtn = document.getElementById('send-chat');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    const fullscreenBtn = document.getElementById('toggle-fullscreen-btn');
    const clearHistoryBtn = document.getElementById('clear-history-btn');

    let allDocsContent = null;
    let isContentLoading = false;
    let chatHistory = [];

    function rebuildChatFromHistory() {
        chatMessages.innerHTML = '';
        chatHistory.forEach(turn => {
            const sender = turn.role === 'user' ? 'user' : 'bot';
            addMessage(sender, turn.parts[0].text, false);
        });
    }

    function saveHistory() {
        sessionStorage.setItem('geminiChatHistory', JSON.stringify(chatHistory));
    }

    clearHistoryBtn.addEventListener('click', () => {
        chatHistory = [];
        sessionStorage.removeItem('geminiChatHistory');
        chatMessages.innerHTML = '';
        addMessage('bot', window.INITIAL_PROMPT);
    });

    fullscreenBtn.addEventListener('click', () => {
        chatbot.classList.toggle('fullscreen');
    });

    function addCopyButtons(parentElement) {
        const codeBlocks = parentElement.querySelectorAll('pre');
        codeBlocks.forEach(block => {
            const button = document.createElement('button');
            button.className = 'copy-code-btn';
            button.textContent = 'Copy';

            button.addEventListener('click', () => {
                const code = block.querySelector('code');
                if (navigator.clipboard && code) {
                    navigator.clipboard.writeText(code.innerText).then(() => {
                        button.textContent = 'Copied!';
                        setTimeout(() => { button.textContent = 'Copy'; }, 2000);
                    });
                }
            });
            block.appendChild(button);
        });
    }

    function addMessage(sender, text, addToHistory = true) {
        const message = document.createElement('div');
        message.classList.add(sender === 'user' ? 'user-message' : 'bot-message');

        const processedText = (sender === 'bot') ? marked.parse(text) : text;

        if (sender === 'bot') {
            message.innerHTML = processedText;
            addCopyButtons(message);
        } else {
            message.textContent = processedText;
        }

        if (addToHistory) {
            chatHistory.push({ role: (sender === 'user' ? 'user' : 'model'), parts: [{ text: text }] });
            saveHistory();
        }

        chatMessages.appendChild(message);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function loadContent() {
        if (allDocsContent || isContentLoading) return;
        isContentLoading = true;

        const savedHistory = sessionStorage.getItem('geminiChatHistory');
        if (!savedHistory) {
            addMessage('bot', 'Loading documentation...', false);
        }

        try {
            const response = await fetch(window.ALL_CONTENT_URL);
            if (!response.ok) throw new Error('Failed to load documentation content.');
            const data = await response.json();
            allDocsContent = data.map(doc => `Page: ${doc.title}\nURL: ${doc.url}\nContent:\n${doc.content}`).join('\n\n---\n\n');

            const loadingMessage = Array.from(chatMessages.children).find(child => child.textContent.includes('Loading documentation...'));
            if (loadingMessage) loadingMessage.remove();

            if (!savedHistory) {
                addMessage('bot', window.INITIAL_PROMPT);
            }

        } catch (error) {
            console.error(error);
            addMessage('bot', 'Sorry, I failed to load the documentation.');
        } finally {
            isContentLoading = false;
        }
    }

    openChatBtn.addEventListener('click', () => {
        chatbot.style.display = 'flex';
        openChatBtn.style.display = 'none';

        const savedHistory = sessionStorage.getItem('geminiChatHistory');
        if (savedHistory) {
            chatHistory = JSON.parse(savedHistory);
            rebuildChatFromHistory();
        }

        if (!allDocsContent) {
            loadContent();
        } else if (!savedHistory) {
            addMessage('bot', window.INITIAL_PROMPT);
        }
    });

    closeChatBtn.addEventListener('click', () => {
        chatbot.style.display = 'none';
        openChatBtn.style.display = 'block';
    });

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });


    async function sendMessage() {
        const messageText = chatInput.value.trim();
        if (messageText === '' || isContentLoading) return;
        addMessage('user', messageText);
        chatInput.value = '';

        if (!allDocsContent) {
            addMessage('bot', 'The documentation is still loading. Please wait a moment.');
            return;
        }

        try {
            const systemInstruction = {
                role: "system",
                parts: [{ text: `You are an expert AI assistant for this documentation. Your primary goal is to provide accurate answers and always link to the source material with the highest possible precision.

DOCUMENTATION FORMAT:
The documentation is provided as pages. Each page has a Title, a URL, and Content.
The Content contains the full text of the page, followed by a special "LINKABLE SECTIONS" block. This block contains markers for specific sections, formatted as: \`[ANCHOR: #anchor-name] Text of the section [/ANCHOR]\`.

RULES FOR LINKING:
1.  **PRECISION FIRST:** When you mention a specific function, class, or section that has an ANCHOR marker, you MUST create a link to that specific anchor. To do this, combine the page's URL with the ANCHOR.
    **Example:** The page URL is \`/reference/\` and you find the marker \`[ANCHOR: #wide_lib.kafka]\`. You MUST format the link as: \`[wide_lib.kafka](/reference/#wide_lib.kafka)\`.
2.  **FALLBACK TO PAGE LINKS:** If you can't find a specific anchor for a topic but know which page it's on, link to the page.
    **Example:** "You can find more details in the [API Reference](/reference/)."

FORMATTING:
- Format your entire response using Markdown.
- Use code blocks (\`\`\`python) for code snippets.
---
DOCUMENTATION:
${allDocsContent}`}]
            };

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${window.GEMINI_MODEL}:generateContent?key=${window.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: chatHistory,
                    systemInstruction: systemInstruction
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API error: ${errorData.error.message}`);
            }
            const data = await response.json();
            const botResponse = data.candidates[0].content.parts[0].text;
            addMessage('bot', botResponse);
        } catch (error) {
            console.error('Error fetching from Gemini API:', error);
            addMessage('bot', `Sorry, I encountered an error: ${error.message}`);
        }
    }
});
