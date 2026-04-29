/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const STORE_MAPPING: Record<string, string> = {
  '네이버': 'D10917',
  'W컨셉': 'D10787',
  '에이블리': 'D10777',
  '무신사': 'D10717',
  '지그재그': 'D10678',
  '직영해외쇼핑몰(페이팔)': 'D10577',
  '직영해외쇼핑몰(엑심베이)': 'D10557',
  '(온)29CM': 'D10527',
  '칼린CJ몰': 'D10267',
  '칼린신세계몰': 'D10057',
  '칼린몰': 'D09977'
};

export interface OrderRow {
  주문번호: string;
  수령인: string;
  전화번호: string;
  핸드폰: string;
  주소: string;
  상품명: string;
  옵션: string;
  수량: number;
  배송메세지: string;
  판매가: number;
  스타일넘버: string;
  [key: string]: any;
}

/**
 * Carlyn Style Code Regex: Starts with W, H, J, T, S (case insensitive) and followed by 8 digits (total 9 chars)
 */
const CARLYN_STYLE_REGEX = /^[WHJTSwhjts][0-9]{8}$/;

/**
 * Port of standardized_columns from Python with enhancements for Carlyn specific logic
 */
export function standardizeColumns(data: any[]): OrderRow[] {
  return data.map(row => {
    const newRow: any = {
      '주문번호': '',
      '수령인': '',
      '전화번호': '',
      '핸드폰': '',
      '주소': '',
      '상품명': '',
      '옵션': '',
      '수량': 0,
      '배송메세지': '',
      '판매가': 0,
      '스타일넘버': ''
    };

    const originalKeys = Object.keys(row);
    
    originalKeys.forEach(originalCol => {
      const c = String(originalCol).replace(/\s/g, '').replace(/\n/g, '').replace(/\r/g, '').trim();
      const value = row[originalCol];

      if (['주문번호', '고객주문번호', '상품주문번호'].includes(c)) newRow['주문번호'] = String(value || '');
      else if (['수령자', '수령인', '인수자', '수취인', '수취인명', '수령인성명', '받는분'].includes(c)) newRow['수령인'] = String(value || '');
      else if (['전화번호', '수취인연락처1', '수령인전화번호', '받는분전화번호', '인수자TEL1', '수령인전화', '수령인연락처'].includes(c)) newRow['전화번호'] = String(value || '');
      else if (['핸드폰', '수령자연락처', '수취인연락처2', '수령인가타연락처', '수령인핸드폰', '인수자hp'].includes(c)) newRow['핸드폰'] = String(value || '');
      else if (['주소', '수령자주소', '신주소', '상세배송지', '배송지', '배송지주소', '받는주소', '수취인도로명주소', '받는분주소', '수령인주소(전체,분할)'].includes(c)) newRow['주소'] = String(value || '');
      else if (['[상품번호]상품명', '상품명', '주문상품명(옵션/수량포함)', '웹상품명', '주문상품명'].includes(c)) newRow['상품명'] = String(value || '');
      else if (c.includes('옵션') || c.includes('상품옵션')) newRow['옵션'] = String(value || '');
      else if (['주문수량', '수량', '주문품목수량', '지시수량'].includes(c)) newRow['수량'] = Number(value || 0);
      else if (['배송메시지', '배송요청사항', '배송메모', '고객배송메모', '배송메세지(주문메세지)', '특이사항'].includes(c)) newRow['배송메세지'] = String(value || '');
      else if (['판매가', '판매가단가', '결제금액(품목별)', '상품가격'].includes(c)) newRow['판매가'] = Number(value || 0);
      else if (['스타일넘버', '상품코드', '판매자상품코드', '스타일코드', '판매자내부코드1', '품목코드'].includes(c)) newRow['스타일넘버'] = String(value || '');
    });

    // Smart Detection: If 스타일넘버 is empty, scan all columns for the pattern [WHJTS]\d{8}
    if (!newRow['스타일넘버'] || newRow['스타일넘버'].trim() === '') {
      for (const key of originalKeys) {
        const valStr = String(row[key]).trim();
        if (CARLYN_STYLE_REGEX.test(valStr)) {
          newRow['스타일넘버'] = valStr;
          break;
        }
      }
    }

    // Try to extract from product name or option if still missing
    if (!newRow['스타일넘버'] || newRow['스타일넘버'].trim() === '') {
       const textToScan = `${newRow['상품명']} ${newRow['옵션']}`;
       const match = textToScan.match(/[WHJTSwhjts][0-9]{8}/);
       if (match) newRow['스타일넘버'] = match[0];
    }

    // Fix phone logic if handphone is empty
    if (!newRow['핸드폰'] && newRow['전화번호']) newRow['핸드폰'] = newRow['전화번호'];
    
    // Clean order number (remove .0)
    if (newRow['주문번호']) {
       newRow['주문번호'] = String(newRow['주문번호']).replace(/\.0$/, '').trim();
    }

    return newRow as OrderRow;
  });
}

/**
 * Port of extract_color_code from Python
 */
export function extractColorCode(optStr: string): string {
  optStr = String(optStr).trim();
  if (!optStr || optStr.toLowerCase() === 'nan') return '';

  // Match (BK) or (IVO)
  const bracketMatch = optStr.match(/\(([A-Za-z]{1,3})\)/);
  if (bracketMatch) {
    let code = bracketMatch[1].toUpperCase();
    return code.length === 1 ? code + '0' : code;
  }

  let cleanStr = optStr.toUpperCase().replace(/[^A-Z가-힣]/g, '');
  const wordsToRemove = ['COLOR', 'FREE', 'SIZE', 'ONESIZE', 'SET', 'OPTION', '컬러', '색상', '가방', '파우치'];
  wordsToRemove.forEach(word => {
    cleanStr = cleanStr.replace(new RegExp(word, 'g'), '');
  });

  const letterHangulMatch = cleanStr.match(/([A-Z]{1,3})[가-힣]|[가-힣]([A-Z]{1,3})/);
  if (letterHangulMatch) {
    let code = letterHangulMatch[1] || letterHangulMatch[2];
    return code.length === 1 ? code + '0' : code;
  }

  const letterMatch = cleanStr.match(/([A-Z]+)/);
  if (letterMatch) {
    let code = letterMatch[1];
    if (code.length === 1) return code + '0';
    if (code.length <= 3) return code;
    return code.substring(0, 2);
  }

  return '';
}
