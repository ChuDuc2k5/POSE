import { Injectable } from '@nestjs/common';
import { ProcessedAiMessage, PropertyContext, ToolActivity } from './types.js';

@Injectable()
export class AiService {
  processMessage(input: {
    content: string;
    customerName: string;
    lead: any;
    language?: 'vi' | 'en';
    propertyContext?: PropertyContext;
  }): ProcessedAiMessage {
    const intent = this.detectIntent(input.content);
    const toolActivity = this.executeTool(intent, input.content, input.propertyContext);
    const leadUpdate = this.updateLeadAnalysis(input.content, input.lead, intent);
    const content = this.generateResponse({
      intent,
      content: input.content,
      lead: input.lead,
      toolActivity,
      customerName: input.customerName,
      language: input.language ?? 'vi',
      propertyContext: input.propertyContext,
    });

    return {
      content,
      intent,
      toolActivity,
      leadUpdate,
      propertyContext: input.propertyContext,
      processing: [
        { stage: 'understanding', message: 'Understanding request', completed: true },
        { stage: 'intent', message: 'Detecting intent', completed: true },
        { stage: 'retrieving', message: 'Searching customer data', completed: true },
        { stage: 'generating', message: 'Generating response', completed: true },
      ],
    };
  }

  ask(input: { content: string; customerName: string; propertyContext?: PropertyContext; lead?: any; language?: 'vi' | 'en' }): ProcessedAiMessage {
    return this.processMessage({
      content: input.content,
      customerName: input.customerName,
      language: input.language ?? 'vi',
      lead: input.lead ?? {
        score: 82,
        classification: 'HOT',
        budget: '3 tỷ',
        productInterest: 'Apartment',
        location: 'TP.HCM',
        timeline: '1 tháng',
        interestLevel: 'Cao',
        purchaseIntent: 'Cao',
        rejectionReason: null,
        nextFollowUp: 'Ngày mai',
        status: 'Active',
      },
      propertyContext: input.propertyContext,
    });
  }

  searchProperties(input: { budget?: number; location?: string; propertyType?: string; bedrooms?: number }): any[] {
    const properties = [
      { id: 'prop-001', title: 'Căn hộ 3PN GH3', location: 'Vinhomes Grand Park', price: 4200000000, area: 83, bedrooms: 3, bathrooms: 2, type: 'Apartment' },
      { id: 'prop-002', title: 'Căn hộ 2PN View River', location: 'District 7', price: 3100000000, area: 72, bedrooms: 2, bathrooms: 2, type: 'Apartment' },
      { id: 'prop-003', title: 'Căn hộ 2PN Sky Garden', location: 'Thu Duc', price: 2800000000, area: 68, bedrooms: 2, bathrooms: 2, type: 'Apartment' },
    ];

    return properties.filter((property) => {
      const budgetMatch = input.budget ? property.price <= input.budget : true;
      const locationMatch = input.location ? property.location.toLowerCase().includes(input.location.toLowerCase()) : true;
      const typeMatch = input.propertyType ? property.type.toLowerCase() === input.propertyType.toLowerCase() : true;
      const bedroomMatch = input.bedrooms ? property.bedrooms === input.bedrooms : true;
      return budgetMatch && locationMatch && typeMatch && bedroomMatch;
    });
  }

  calculateMortgage(input: { propertyPrice: number; downPaymentPercent: number; years: number; interestRate: number }): any {
    const principal = input.propertyPrice * (1 - input.downPaymentPercent / 100);
    const monthlyRate = (input.interestRate / 100) / 12;
    const months = input.years * 12;
    const monthlyPayment = monthlyRate > 0
      ? (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
      : principal / months;

    return {
      propertyPrice: input.propertyPrice,
      loanAmount: principal,
      monthlyPayment: Math.round(monthlyPayment),
      downPayment: input.propertyPrice * (input.downPaymentPercent / 100),
      totalInterest: Math.round(monthlyPayment * months - principal),
    };
  }

  detectIntent(content: string): string {
    const lower = content.toLowerCase();

    if (lower.includes('vay') || lower.includes('khoản vay') || lower.includes('mortgage') || lower.includes('trả hàng tháng')) {
      return 'MORTGAGE_CALCULATION';
    }

    if (lower.includes('tìm nhà') || lower.includes('mua căn hộ') || lower.includes('thuê nhà') || lower.includes('căn hộ') || lower.includes('3 tỷ') || lower.includes('3ty') || lower.includes('tỷ') || lower.includes('budget') || lower.includes('giá')) {
      return 'PROPERTY_SEARCH';
    }

    if (lower.includes('không quan tâm') || lower.includes('không cần') || lower.includes('không thích')) {
      return 'NO_INTEREST';
    }

    if (lower.includes('gọi lại') || lower.includes('call lại') || lower.includes('gọi lại cho')) {
      return 'REQUEST_CALLBACK';
    }

    if (lower.includes('quận') || lower.includes('vị trí') || lower.includes('khu vực')) {
      return 'LOCATION';
    }

    return 'GENERAL';
  }

  executeTool(intent: string, content: string, propertyContext?: PropertyContext): ToolActivity {
    const budget = this.parseBudget(content) ?? 3000000000;

    if (intent === 'SEARCH_PRODUCT' || intent === 'PROPERTY_SEARCH') {
      const location = this.extractLocation(content) ?? 'TP.HCM';
      const properties = this.searchProperties({ budget, location, propertyType: 'Apartment', bedrooms: 2 });
      return {
        tool: 'search_products',
        input: { budget, location, propertyType: 'Apartment' },
        result: {
          products: properties,
          totalFound: properties.length,
        },
        durationMs: 320,
        status: 'success',
      };
    }

    if (intent === 'MORTGAGE_CALCULATION' || content.toLowerCase().includes('vay') || content.toLowerCase().includes('khoản vay')) {
      const price = propertyContext?.price ?? 4200000000;
      const rate = 7.2;
      const years = 15;
      return {
        tool: 'calculate_mortgage',
        input: { propertyPrice: price, downPaymentPercent: 70, years, interestRate: rate },
        result: this.calculateMortgage({ propertyPrice: price, downPaymentPercent: 70, years, interestRate: rate }),
        durationMs: 170,
        status: 'success',
      };
    }

    if (intent === 'LOCATION') {
      return {
        tool: 'get_customer_context',
        input: { content },
        result: { location: 'Quận 7', areaMatch: true },
        durationMs: 180,
        status: 'success',
      };
    }

    return {
      tool: 'get_customer_context',
      input: { content },
      result: { summary: 'No tool needed' },
      durationMs: 90,
      status: 'success',
    };
  }

  generateResponse(input: {
    intent: string;
    content: string;
    customerName: string;
    lead: any;
    toolActivity: ToolActivity;
    language?: 'vi' | 'en';
    propertyContext?: PropertyContext;
  }): string {
    if (input.language === 'en') {
      if (input.intent === 'PROPERTY_SEARCH' || input.intent === 'SEARCH_PRODUCT') {
        return 'I found homes around 2.8 and 3.1 billion VND. Which area would you like me to search?';
      }
      if (input.intent === 'MORTGAGE_CALCULATION') {
        return `For a home priced around ${this.formatCurrency(input.propertyContext?.price ?? 4200000000)}, the estimated monthly payment is based on a 70% down payment over 15 years at 7.2% annual interest.`;
      }
      if (input.intent === 'LOCATION') return 'We currently have options in District 7 and District 9. Tell me your budget and I will prepare a shortlist.';
      if (input.intent === 'NO_INTEREST') return 'Understood. I am here whenever you need more help.';
      if (input.intent === 'REQUEST_CALLBACK') return 'I will note your callback request and arrange a suitable time.';
      return `I have noted your request, ${input.customerName}. I can help find a home, calculate a mortgage, or compare properties.`;
    }

    const lower = input.content.toLowerCase();

    if (input.intent === 'SEARCH_PRODUCT' || input.intent === 'PROPERTY_SEARCH') {
      return 'Dạ hiện bên em có sản phẩm khoảng 2.8 tỷ và 3.1 tỷ. Anh/chị đang quan tâm khu vực nào để em tìm chính xác hơn ạ?';
    }

    if (input.intent === 'MORTGAGE_CALCULATION') {
      const price = input.propertyContext?.price ?? 4200000000;
      const monthly = this.calculateMortgage({ propertyPrice: price, downPaymentPercent: 70, years: 15, interestRate: 7.2 }).monthlyPayment;
      return `Với giá trị căn nhà khoảng ${this.formatCurrency(price)} và tỷ lệ trả trước 70%, khoản vay hàng tháng ước tính khoảng ${this.formatCurrency(monthly)} đồng/Tháng trong 15 năm với lãi suất 7.2%/năm.`;
    }

    if (input.intent === 'LOCATION') {
      return 'Dạ hiện bên em đang có sản phẩm ở Quận 7 và Quận 9, tùy theo ngân sách anh/chị muốn em gửi shortlist phù hợp nhất ạ.';
    }

    if (input.intent === 'NO_INTEREST') {
      return 'Dạ vâng, em hiểu. Nếu anh/chị đổi ý hoặc cần tư vấn thêm trong tương lai, em sẵn sàng hỗ trợ ạ.';
    }

    if (input.intent === 'REQUEST_CALLBACK') {
      return 'Dạ vâng, em sẽ ghi nhận yêu cầu gọi lại và sắp xếp lịch phù hợp cho anh/chị ạ.';
    }

    return `Dạ, em đã ghi nhận thông tin của anh/chị ${input.customerName}. Em có thể giúp tìm căn phù hợp, tính khoản vay hoặc phân tích bất động sản hiện tại ạ.`;
  }

  private parseBudget(content: string): number | null {
    const matches = content.match(/(\d+(?:[.,]\d+)?)\s*(?:tỷ|ty|triệu|tr)/i);
    if (!matches) return null;

    const value = Number(matches[1].replace(',', '.'));
    return matches[0].toLowerCase().includes('triệu') ? value * 1000000 : value * 1000000000;
  }

  private extractLocation(content: string): string | null {
    const lower = content.toLowerCase();
    if (lower.includes('quận 7')) return 'Quận 7';
    if (lower.includes('quận 9')) return 'Quận 9';
    if (lower.includes('thủ đức')) return 'Thủ Đức';
    if (lower.includes('hcm') || lower.includes('tp.hcm') || lower.includes('sài gòn')) return 'TP.HCM';
    return null;
  }

  private formatCurrency(amount: number): string {
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(amount)} đồng`;
  }

  private updateLeadAnalysis(content: string, lead: any, intent: string): Partial<any> {
    const lower = content.toLowerCase();
    const score = Math.min(99, Math.max(35, (lead?.score ?? 80) + 4));

    const nextLead = {
      score,
      classification: score >= 80 ? 'HOT' : score >= 60 ? 'WARM' : 'COLD',
      budget: this.extractBudget(content, lead?.budget ?? '3 tỷ'),
      productInterest: lower.includes('căn hộ') || lower.includes('apartment') ? 'Apartment' : 'Property',
      location: lower.includes('quận 7') ? 'Quận 7' : lower.includes('quận 9') ? 'Quận 9' : (lead?.location ?? 'Quận 9'),
      timeline: lower.includes('tháng') ? '1 tháng' : (lead?.timeline ?? '1 tháng'),
      interestLevel: lower.includes('không thích') ? 'Thấp' : (lead?.interestLevel ?? 'Cao'),
      purchaseIntent: intent === 'NO_INTEREST' ? 'Thấp' : (lead?.purchaseIntent ?? 'Cao'),
      rejectionReason: intent === 'NO_INTEREST' ? 'Khách hàng không quan tâm' : null,
      nextFollowUp: intent === 'REQUEST_CALLBACK' ? 'Ngày mai' : (lead?.nextFollowUp ?? 'Ngày mai'),
      status: intent === 'NO_INTEREST' ? 'Closed' : 'Active',
    };

    return nextLead;
  }

  private extractBudget(content: string, fallback: string): string {
    const budget = this.parseBudget(content);
    if (!budget) return fallback;
    return `${(budget / 1000000000).toFixed(1).replace('.0', '')} tỷ`;
  }
}
