import type {
  MessageRenderer,
  ProtocolDecision,
  NegotiationPhase,
  ActiveTerm,
  BuddyTone,
} from '../types.js';

interface RenderContext {
  phase: NegotiationPhase;
  role: 'buyer' | 'seller';
  locale: string;
  activeTerms?: ActiveTerm[];
  tone: BuddyTone;
}

/**
 * Template-based Message Renderer.
 * Converts ProtocolDecision → user-facing message using BuddyTone.
 */
export class TemplateMessageRenderer implements MessageRenderer {
  render(decision: ProtocolDecision, context: RenderContext): string {
    const { action, price, non_price_terms } = decision;
    const { tone, role, phase, locale } = context;

    // Route to locale-specific templates
    let message = locale === 'ko'
      ? this.getKoreanTemplate(action, price, tone, role, phase)
      : this.getActionTemplate(action, price, tone, role, phase);

    // Append non-price terms if present
    if (non_price_terms && Object.keys(non_price_terms).length > 0) {
      message += '\n' + this.renderTerms(non_price_terms, tone);
    }

    // Add signature phrase occasionally
    if (tone.signature_phrases && tone.signature_phrases.length > 0) {
      const useSignature = Math.random() < 0.3; // 30% chance
      if (useSignature) {
        const phrase = tone.signature_phrases[Math.floor(Math.random() * tone.signature_phrases.length)]!;
        message += ` ${phrase}`;
      }
    }

    // Emoji handling
    if (tone.emoji_use) {
      message = this.addEmoji(message, action);
    }

    return message;
  }

  private getActionTemplate(
    action: ProtocolDecision['action'],
    price: number | undefined,
    tone: BuddyTone,
    role: 'buyer' | 'seller',
    phase: NegotiationPhase,
  ): string {
    const priceStr = price ? `$${price}` : '';
    const { style, formality } = tone;

    switch (action) {
      case 'COUNTER':
        return this.counterTemplate(priceStr, style, formality, role);
      case 'ACCEPT':
        return this.acceptTemplate(priceStr, style, formality);
      case 'REJECT':
        return this.rejectTemplate(style, formality);
      case 'HOLD':
        return this.holdTemplate(style, formality);
      case 'DISCOVER':
        return this.discoverTemplate(style, formality, role);
      case 'CONFIRM':
        return this.confirmTemplate(priceStr, style, formality);
      default:
        return `Decision: ${action}${priceStr ? ` at ${priceStr}` : ''}`;
    }
  }

  private counterTemplate(price: string, style: BuddyTone['style'], formality: BuddyTone['formality'], role: string): string {
    if (style === 'professional') {
      return formality === 'formal'
        ? `I'd like to propose ${price} for this item.`
        : `How about ${price}?`;
    }
    if (style === 'friendly') {
      return formality === 'informal'
        ? `What do you think about ${price}? I think that's pretty fair!`
        : `I think ${price} would be a good price for both of us.`;
    }
    if (style === 'analytical') {
      return `Based on market data, ${price} reflects fair value for the current condition.`;
    }
    if (style === 'assertive') {
      return formality === 'formal'
        ? `My offer is ${price}. This is a strong and fair proposal.`
        : `${price} — that's my number.`;
    }
    if (style === 'casual') {
      return `How about ${price}? Seems pretty reasonable to me.`;
    }
    return `I'm offering ${price}.`;
  }

  private acceptTemplate(price: string, style: BuddyTone['style'], formality: BuddyTone['formality']): string {
    if (style === 'professional') return `Agreed${price ? ` at ${price}` : ''}. Let's proceed.`;
    if (style === 'friendly') return `Deal${price ? ` at ${price}` : ''}! Glad we could work this out!`;
    if (style === 'analytical') return `Accepted${price ? ` at ${price}` : ''}. This falls within optimal range.`;
    if (style === 'assertive') return `Accepted${price ? ` at ${price}` : ''}. Good terms.`;
    if (style === 'casual') return `Sounds good${price ? `, ${price} works` : ''}!`;
    return `Accepted${price ? ` at ${price}` : ''}.`;
  }

  private rejectTemplate(style: BuddyTone['style'], formality: BuddyTone['formality']): string {
    if (style === 'professional') return 'I appreciate the offer, but I\'ll need to pass on those terms.';
    if (style === 'friendly') return 'Thanks for the offer, but I can\'t quite make that work. Can we try again?';
    if (style === 'analytical') return 'The offer doesn\'t meet the acceptable range. Let\'s reconsider the terms.';
    if (style === 'assertive') return 'That doesn\'t work for me. I need a better offer.';
    if (style === 'casual') return 'Nah, that\'s not gonna work for me. Got a better number?';
    return 'I\'m unable to accept those terms.';
  }

  private holdTemplate(style: BuddyTone['style'], formality: BuddyTone['formality']): string {
    if (style === 'professional') return 'I\'d like to take a moment to review the current terms.';
    if (style === 'friendly') return 'Let me think about this for a sec — I want to make sure this is right for both of us.';
    if (style === 'analytical') return 'Pausing to reassess. Need to verify some details before proceeding.';
    if (style === 'assertive') return 'Hold on. I need to review before moving forward.';
    if (style === 'casual') return 'Gimme a sec to think this over.';
    return 'I\'d like to pause and review.';
  }

  private discoverTemplate(style: BuddyTone['style'], formality: BuddyTone['formality'], role: string): string {
    if (role === 'buyer') {
      if (style === 'professional') return 'Could you tell me more about the item\'s condition?';
      if (style === 'friendly') return 'Hey! I\'m really interested. Can you share more details about it?';
      if (style === 'analytical') return 'I\'d like to understand the specific condition metrics — battery health, screen state, accessories?';
      if (style === 'assertive') return 'I need the full details: condition, battery, accessories, and verification status.';
      if (style === 'casual') return 'So what\'s the deal with this one? How\'s the condition?';
    } else {
      if (style === 'professional') return 'I\'d be happy to provide details. What would you like to know?';
      if (style === 'friendly') return 'Sure thing! Ask me anything about it.';
      if (style === 'analytical') return 'I can provide detailed condition data. What specifics do you need?';
      if (style === 'assertive') return 'Here\'s what I can tell you — ask and I\'ll give you the facts.';
      if (style === 'casual') return 'What do you wanna know? Happy to share.';
    }
    return 'Let\'s start by discussing the item details.';
  }

  private confirmTemplate(price: string, style: BuddyTone['style'], formality: BuddyTone['formality']): string {
    if (style === 'professional') return `Confirming the agreement${price ? ` at ${price}` : ''}. Ready to proceed to settlement.`;
    if (style === 'friendly') return `Awesome, we have a deal${price ? ` at ${price}` : ''}! Let's wrap this up.`;
    if (style === 'analytical') return `Confirmed${price ? ` at ${price}` : ''}. All terms verified. Proceeding to settlement.`;
    if (style === 'assertive') return `Confirmed${price ? ` at ${price}` : ''}. Let's close this out.`;
    if (style === 'casual') return `Done deal${price ? `, ${price}` : ''}! Let's do this.`;
    return `Confirmed${price ? ` at ${price}` : ''}. Proceeding to settlement.`;
  }

  // ─── Korean Templates ──────────────────────────────────────────────

  private getKoreanTemplate(
    action: ProtocolDecision['action'],
    price: number | undefined,
    tone: BuddyTone,
    role: 'buyer' | 'seller',
    phase: NegotiationPhase,
  ): string {
    const priceStr = price ? `$${price}` : '';
    const { style } = tone;

    switch (action) {
      case 'COUNTER':
        if (style === 'professional') return `${priceStr}을 제안드립니다.`;
        if (style === 'friendly') return `${priceStr} 어떠세요? 합리적인 가격이라고 생각해요!`;
        if (style === 'analytical') return `시장 데이터 기준으로 ${priceStr}이 적정 가격입니다.`;
        if (style === 'assertive') return `${priceStr}입니다. 공정한 제안이에요.`;
        if (style === 'casual') return `${priceStr} 어때요?`;
        return `${priceStr}을 제안합니다.`;

      case 'ACCEPT':
        if (style === 'professional') return `${priceStr ? `${priceStr}에 ` : ''}합의합니다. 진행하겠습니다.`;
        if (style === 'friendly') return `좋아요${priceStr ? `, ${priceStr}에` : ''} 거래 성사! 잘 됐네요!`;
        if (style === 'analytical') return `${priceStr ? `${priceStr} ` : ''}수락합니다. 적정 범위 내입니다.`;
        if (style === 'assertive') return `${priceStr ? `${priceStr} ` : ''}수락. 좋은 조건이네요.`;
        if (style === 'casual') return `${priceStr ? `${priceStr}에 ` : ''}딜!`;
        return `${priceStr ? `${priceStr}에 ` : ''}수락합니다.`;

      case 'REJECT':
        if (style === 'professional') return '제안 감사드리지만, 이 조건으로는 어렵습니다.';
        if (style === 'friendly') return '감사하지만 좀 어려울 것 같아요. 다시 한번 제안해주실 수 있나요?';
        if (style === 'analytical') return '제안이 수용 범위에 들지 않습니다. 조건을 재검토해주세요.';
        if (style === 'assertive') return '이 조건은 안 됩니다. 더 나은 제안이 필요해요.';
        if (style === 'casual') return '음, 좀 안 맞는 것 같아요. 다른 가격은요?';
        return '이 조건은 수락하기 어렵습니다.';

      case 'HOLD':
        if (style === 'professional') return '잠시 현재 조건을 검토하겠습니다.';
        if (style === 'friendly') return '잠깐만요, 양쪽 다 좋은 결과가 되도록 생각해볼게요.';
        if (style === 'analytical') return '잠시 멈추고 재평가하겠습니다. 몇 가지 확인이 필요합니다.';
        if (style === 'assertive') return '잠시요. 진행 전에 검토가 필요합니다.';
        if (style === 'casual') return '잠깐 생각 좀 할게요.';
        return '잠시 검토하겠습니다.';

      case 'DISCOVER':
        if (role === 'buyer') {
          if (style === 'professional') return '제품 상태에 대해 자세히 알려주실 수 있나요?';
          if (style === 'friendly') return '관심이 많아요! 제품 상태 좀 더 알려주실 수 있나요?';
          if (style === 'analytical') return '배터리 상태, 화면 상태, 부속품 등 구체적인 사양을 알고 싶습니다.';
          if (style === 'assertive') return '상태, 배터리, 부속품, 인증 상태 전부 알려주세요.';
          if (style === 'casual') return '상태가 어때요?';
        } else {
          if (style === 'professional') return '자세한 정보를 드리겠습니다. 궁금한 점이 있으신가요?';
          if (style === 'friendly') return '편하게 물어보세요! 뭐든 답해드릴게요.';
          if (style === 'analytical') return '상세 상태 데이터를 제공할 수 있습니다. 어떤 항목이 필요하신가요?';
          if (style === 'assertive') return '궁금한 게 있으면 물어보세요. 팩트로 답하겠습니다.';
          if (style === 'casual') return '궁금한 거 있으면 물어봐요!';
        }
        return '제품 상세 정보를 확인하겠습니다.';

      case 'CONFIRM':
        if (style === 'professional') return `${priceStr ? `${priceStr}에 ` : ''}합의를 확인합니다. 결제를 진행하겠습니다.`;
        if (style === 'friendly') return `${priceStr ? `${priceStr}에 ` : ''}거래 확정! 마무리하죠!`;
        if (style === 'analytical') return `${priceStr ? `${priceStr} ` : ''}확인 완료. 모든 조건 검증됨. 결제로 진행합니다.`;
        if (style === 'assertive') return `${priceStr ? `${priceStr} ` : ''}확인. 마무리합시다.`;
        if (style === 'casual') return `${priceStr ? `${priceStr}에 ` : ''}완료! 갑시다!`;
        return `${priceStr ? `${priceStr}에 ` : ''}확인합니다. 결제로 진행합니다.`;

      default:
        return `결정: ${action}${priceStr ? ` (${priceStr})` : ''}`;
    }
  }

  private renderTerms(terms: Record<string, unknown>, tone: BuddyTone): string {
    const entries = Object.entries(terms);
    if (entries.length === 0) return '';

    if (tone.style === 'analytical') {
      return 'Additional terms: ' + entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ');
    }
    if (tone.style === 'casual') {
      return 'Also: ' + entries.map(([k, v]) => `${k} → ${String(v)}`).join(', ');
    }
    return 'Terms: ' + entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ');
  }

  private addEmoji(message: string, action: ProtocolDecision['action']): string {
    const emojiMap: Record<string, string> = {
      COUNTER: '💬',
      ACCEPT: '🤝',
      REJECT: '❌',
      HOLD: '⏸️',
      DISCOVER: '🔍',
      CONFIRM: '✅',
    };
    const emoji = emojiMap[action] ?? '';
    return emoji ? `${emoji} ${message}` : message;
  }
}
