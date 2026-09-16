"""
ASL Sign Language Assistant — Masaustu Uygulamasi
==================================================
Ana pencere ve navigasyon.
Ceviri ve Ogrenme Kocu modlari arasinda gecis saglar.
"""
import os
import logging

import customtkinter as ctk

from config.settings import (
    WINDOW_WIDTH, WINDOW_HEIGHT, THEME,
    LETTER_MODEL_PATH, JZ_MODEL_PATH, WORD_MODEL_PATH,
    COLOR_PRIMARY, COLOR_PRIMARY_HOVER,
    COLOR_PURPLE, COLOR_PURPLE_HOVER,
    BG_BASE, BG_CARD, BG_ELEVATED, BG_LOWEST,
    TEXT_PRIMARY, TEXT_TERTIARY, TEXT_MUTED,
    ACCENT_SUCCESS, BORDER,
    FONT_FAMILY,
)

# MacOS sistem temasini ezmek icin global seviyede zorunlu dark mode (Premium):
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme(THEME if THEME else "blue")

from asl_desktop.ui.translation_view import TranslationView
from asl_desktop.ui.learning_coach_view import LearningCoachView

_logger = logging.getLogger("ASL.App")


# ═══════════════════════════════════════════════════════
#  Ana Uygulama
# ═══════════════════════════════════════════════════════

class ASLApp(ctk.CTk):
    """ASL Sign Language Assistant — Ana pencere ve navigasyon."""

    def __init__(self):
        super().__init__()

        self.title("ASL Sign Language Assistant")
        self.geometry(f"{WINDOW_WIDTH}x{WINDOW_HEIGHT}")
        self.minsize(1280, 800)
        self._dark_mode = True

        self._current_view = None
        self._show_home()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ── Ana Ekran ──

    def _show_home(self) -> None:
        self._clear_view()
        F = ctk.CTkFont

        home = ctk.CTkFrame(self, fg_color=BG_LOWEST)
        home.pack(fill="both", expand=True)

        # ── Merkez kart ──
        card = ctk.CTkFrame(home, width=700, height=480, corner_radius=24,
                             fg_color=BG_CARD, border_width=1, border_color=BORDER)
        card.place(relx=0.5, rely=0.48, anchor="center")
        card.pack_propagate(False)

        # Baslik alani
        header = ctk.CTkFrame(card, fg_color="transparent")
        header.pack(pady=(28, 16))

        ctk.CTkLabel(header, text="🤟",
                      font=F(family=FONT_FAMILY, size=48)).pack(pady=(0, 4))
        ctk.CTkLabel(header, text="ASL Sign Language Assistant",
                      font=F(family=FONT_FAMILY, size=30, weight="bold"),
                      text_color=TEXT_PRIMARY).pack(pady=(0, 2))
        ctk.CTkLabel(header, text="AI Destekli İşaret Dili Asistanı",
                      font=F(family=FONT_FAMILY, size=15),
                      text_color=TEXT_TERTIARY).pack()

        # ── Iki mod karti ──
        cards_row = ctk.CTkFrame(card, fg_color="transparent")
        cards_row.pack(pady=(14, 0))

        def _mode_card(parent, emoji, title, subtitle, color, hover, cmd):
            c = ctk.CTkFrame(parent, width=260, height=120, corner_radius=16,
                              fg_color=color)
            c.pack_propagate(False)
            inner = ctk.CTkFrame(c, fg_color="transparent")
            inner.place(relx=0.5, rely=0.5, anchor="center")
            ctk.CTkLabel(inner, text=f"{emoji}  {title}",
                          font=F(family=FONT_FAMILY, size=19, weight="bold"),
                          text_color="white").pack(pady=(0, 4))
            ctk.CTkLabel(inner, text=subtitle,
                          font=F(family=FONT_FAMILY, size=13),
                          text_color="white", wraplength=210).pack()
            c.bind("<Button-1>", lambda e: cmd())
            c.bind("<Enter>",  lambda e: c.configure(fg_color=hover))
            c.bind("<Leave>",  lambda e: c.configure(fg_color=color))
            for w in c.winfo_children() + inner.winfo_children():
                w.bind("<Button-1>", lambda e: cmd())
            return c

        _mode_card(cards_row,
                   "🔤", "Çeviri Modu",
                   "Canlı kamera ile ASL → Metin → Ses",
                   COLOR_PRIMARY, COLOR_PRIMARY_HOVER,
                   self._show_translation).grid(row=0, column=0, padx=14)

        _mode_card(cards_row,
                   "📚", "Öğrenme Koçu",
                   "Hareketleri gör ve kendini test et",
                   COLOR_PURPLE, COLOR_PURPLE_HOVER,
                   self._show_learning_coach).grid(row=0, column=1, padx=14)

        # ── Model durum satiri ──
        status_row = ctk.CTkFrame(card, fg_color="transparent")
        status_row.pack(pady=(14, 0))
        model_files = [
            ("Harf modeli", LETTER_MODEL_PATH),
            ("J/Z modeli", JZ_MODEL_PATH),
            ("Kelime modeli", WORD_MODEL_PATH),
        ]
        for name, path in model_files:
            exists = os.path.exists(path)
            dot = "● " + name if exists else "○ " + name
            col = ACCENT_SUCCESS if exists else TEXT_MUTED
            ctk.CTkLabel(status_row, text=dot,
                          font=F(family=FONT_FAMILY, size=13),
                          text_color=col).pack(side="left", padx=12)

        # ── Alt cubuk ──
        bottom_bar = ctk.CTkFrame(home, fg_color="transparent")
        bottom_bar.pack(side="bottom", fill="x", padx=24, pady=12)

        ctk.CTkLabel(
            bottom_bar,
            text="Ali Mustafa Ekmen — Yapay Zekâ Uygulamaları Dersi, Mart 2026",
            font=F(family=FONT_FAMILY, size=13),
            text_color=TEXT_MUTED,
        ).pack(side="left")

        theme_text = "☀ Aydınlık" if self._dark_mode else "🌙 Karanlık"
        ctk.CTkButton(
            bottom_bar, text=theme_text,
            width=120, height=34, corner_radius=8,
            font=F(family=FONT_FAMILY, size=13, weight="bold"),
            fg_color="transparent", border_width=1,
            border_color=BG_ELEVATED,
            text_color=TEXT_TERTIARY,
            hover_color=BG_ELEVATED,
            command=self._toggle_theme,
        ).pack(side="right")

        self._current_view = home

    def _show_translation(self) -> None:
        self._clear_view()
        view = TranslationView(self, on_back=self._show_home)
        view.pack(fill="both", expand=True)
        view.start()
        self._current_view = view

    def _show_learning_coach(self) -> None:
        self._clear_view()
        view = LearningCoachView(self, on_back=self._show_home)
        view.pack(fill="both", expand=True)
        view.start()
        self._current_view = view

    def _toggle_theme(self) -> None:
        self._dark_mode = not self._dark_mode
        ctk.set_appearance_mode("dark" if self._dark_mode else "light")
        self._show_home()

    def _clear_view(self) -> None:
        if self._current_view:
            if hasattr(self._current_view, "stop"):
                try:
                    self._current_view.stop()
                except Exception as exc:
                    _logger.warning("View stop sirasinda hata: %s", exc)
            try:
                self._current_view.destroy()
            except Exception as exc:
                _logger.warning("View destroy sirasinda hata: %s", exc)
            self._current_view = None

    def _on_close(self) -> None:
        self._clear_view()
        self.quit()
        self.destroy()
