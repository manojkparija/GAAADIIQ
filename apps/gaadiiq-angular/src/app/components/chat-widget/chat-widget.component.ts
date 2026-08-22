import {
  Component, inject, signal, ViewChild, ElementRef, AfterViewChecked,
  OnDestroy, ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ChatService, ChatMessage, RichContent, CarCard, DiagnosisCard } from '../../services/chat.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat-widget.component.html',
  styleUrl: './chat-widget.component.scss',
})
export class ChatWidgetComponent implements AfterViewChecked, OnDestroy {
  chat = inject(ChatService);

  inputText = signal('');
  @ViewChild('msgList') private msgList!: ElementRef<HTMLDivElement>;

  private shouldScroll = false;

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  ngOnDestroy() {
    // nothing to clean up
  }

  private scrollToBottom() {
    try {
      const el = this.msgList?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch {}
  }

  async onSend() {
    const text = this.inputText().trim();
    if (!text || this.chat.isTyping()) return;
    this.inputText.set('');
    this.shouldScroll = true;
    await this.chat.send(text);
    this.shouldScroll = true;
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.onSend(); }
  }

  async onPrompt(p: string) {
    this.inputText.set('');
    this.shouldScroll = true;
    await this.chat.send(p);
    this.shouldScroll = true;
  }

  asCarCard(r: RichContent): CarCard { return r as CarCard; }
  asDiagCard(r: RichContent): DiagnosisCard { return r as DiagnosisCard; }

  isCarCard(r: RichContent): boolean { return r.type === 'car_card'; }
  isDiagCard(r: RichContent): boolean { return r.type === 'diagnosis_card'; }
  isPrompts(r: RichContent): boolean { return r.type === 'suggested_prompts'; }
  getPrompts(r: RichContent): string[] { return (r as any).prompts || []; }

  formatPrice(n: number): string {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
    if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`;
    return `₹${n.toLocaleString('en-IN')}`;
  }

  formatText(text: string): string {
    // Convert markdown-like bold to <strong>
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  trackMsg(_: number, m: ChatMessage) { return m.id; }
  trackRich(i: number) { return i; }
}
