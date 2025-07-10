import os
import json
import importlib.resources
from dotenv import load_dotenv
from mkdocs.plugins import BasePlugin, get_plugin_logger
from mkdocs.config import config_options as c
from mkdocs.config.base import Config
from bs4 import BeautifulSoup

log = get_plugin_logger(__name__)


class GeminiChatbotConfig(Config):
    gemini_api_key = c.Type(str, default="")
    model = c.Type(str, default="gemini-2.5-flash")
    chat_title = c.Type(str, default="Chat with Gemini")
    initial_prompt = c.Type(
        str, default="Hello! How can I help you with these documents?"
    )


class GeminiChatbotPlugin(BasePlugin[GeminiChatbotConfig]):

    def __init__(self):
        self.enabled = True
        self.all_docs_content = []

    def on_config(self, config, **kwargs):
        load_dotenv(".env")
        if not self.config.gemini_api_key:
            self.config.gemini_api_key = os.getenv("GEMINI_API_KEY")

        if not self.config.gemini_api_key:
            log.warning(
                "Gemini API key not found in mkdocs.yml or .env file. The chatbot will be disabled."
            )
            self.enabled = False

        return config

    def on_post_build(self, config, **kwargs):
        if not self.enabled:
            return
        content_json_path = os.path.join(config["site_dir"], "content.json")
        with open(content_json_path, "w", encoding="utf-8") as f:
            json.dump(self.all_docs_content, f)
        for asset in ["chatbot.css", "chatbot.js"]:
            source_path = importlib.resources.files("mkdocs_gemini_chatbot").joinpath(
                "templates", asset
            )
            subdir = "css" if asset.endswith(".css") else "js"
            dest_path = os.path.join(config["site_dir"], subdir, asset)
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            with source_path.open("r") as f_src, open(dest_path, "w") as f_dest:
                f_dest.write(f_src.read())

    def on_post_page(self, output, page, config, **kwargs):
        if not self.enabled:
            return output
        soup = BeautifulSoup(output, "html.parser")
        content_div = soup.find("article", role="main") or soup.find("body")
        if content_div:

            general_text = content_div.get_text(separator=" ", strip=True)

            anchor_texts = []
            for tag in content_div.find_all(id=True):
                tag_id = tag.get("id")
                tag_text = tag.get_text(separator=" ", strip=True)
                if tag_text:
                    anchor_texts.append(f"[ANCHOR: #{tag_id}] {tag_text} [/ANCHOR]")

            final_content = (
                general_text + "\n\n---LINKABLE SECTIONS---\n" + "\n".join(anchor_texts)
            )

            self.all_docs_content.append(
                {"title": page.title, "url": page.abs_url, "content": final_content}
            )

        site_url = config.get("site_url", "/")
        if not site_url.endswith("/"):
            site_url += "/"

        chatbot_html = f"""
<div id="gemini-chatbot">
    <div id="chat-header">
        <span>{self.config.chat_title}</span>
        <div class="header-buttons">
            <button id="clear-history-btn" title="Clear History">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
            <button id="toggle-fullscreen-btn" title="Toggle Fullscreen">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
            </button>
            <button id="close-chat" title="Close Chat">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41z"/></svg>
            </button>
        </div>
    </div>
    <div id="chat-messages"></div>
    <div id="chat-input-container">
        <input type="text" id="chat-input" placeholder="Ask a question...">
        <button id="send-chat">Send</button>
    </div>
</div>
<button id="open-chat">💬</button>
<link href="{site_url}css/chatbot.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script>
    window.GEMINI_API_KEY = "{self.config.gemini_api_key}";
    window.GEMINI_MODEL = "{self.config.model}";
    window.INITIAL_PROMPT = "{self.config.initial_prompt}";
    window.ALL_CONTENT_URL = "{site_url}content.json";
</script>
<script src="{site_url}js/chatbot.js"></script>
"""
        body_end_tag = "</body>"
        if body_end_tag in output:
            return output.replace(body_end_tag, chatbot_html + body_end_tag)
        return output + chatbot_html
