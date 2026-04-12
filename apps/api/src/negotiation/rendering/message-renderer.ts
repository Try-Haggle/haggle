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
    const { tone, role, phase } = context;

    let message = this.getActionTemplate(action, price, tone, role, phase);

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
