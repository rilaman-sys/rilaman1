/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, 
  Upload, 
  Download, 
  ArrowRight, 
  AlertCircle, 
  Truck,
  Building2,
  X,
  FileSpreadsheet
} from 'lucide-react';
import { cn } from './lib/utils';
import { 
  STORE_MAPPING, 
  standardizeColumns, 
  extractColorCode, 
  OrderRow 
} from './lib/orderUtils';

type TaskMode = 'NONE' | 'TASK_1_5' | 'TASK_2_4';

export default function App() {
  const [mode, setMode] = useState<TaskMode>('NONE');
  const [selectedMall, setSelectedMall] = useState<string>('네이버');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<{time: string, msg: string, type: 'info' | 'warn' | 'success'}[]>([
    { time: new Date().toLocaleTimeString(), msg: 'System engine initialized.', type: 'info' },
    { time: new Date().toLocaleTimeString(), msg: 'Ready for data streams.', type: 'success' }
  ]);

  // Task 1 & 5 state
  const [task1Files, setTask1Files] = useState<File[]>([]);
  
  // Task 2 & 4 state
  const [task2ProcessedFile, setTask2ProcessedFile] = useState<File | null>(null);
  const [task2InvoiceFile, setTask2InvoiceFile] = useState<File | null>(null);

  const addLog = (msg: string, type: 'info' | 'warn' | 'success' = 'info') => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 10));
  };

  const resetState = () => {
    setMode('NONE');
    setTask1Files([]);
    setTask2ProcessedFile(null);
    setTask2InvoiceFile(null);
    setError(null);
    setIsProcessing(false);
  };

  const handleTask1Process = async () => {
    if (task1Files.length === 0) {
      setError('발주서 파일을 선택해주세요.');
      return;
    }
    setIsProcessing(true);
    setError(null);

    try {
      addLog(`Loading ${task1Files.length} source file(s)...`, 'info');
      let allOrders: OrderRow[] = [];

      for (const file of task1Files) {
        const data = await readFile(file);
        const standardized = standardizeColumns(data);
        allOrders = [...allOrders, ...standardized];
        addLog(`Processed ${file.name} (${standardized.length} records)`, 'info');
      }

      // 2. Delivery Transformation
      const groupedByOrder = allOrders.reduce((acc, row) => {
        const id = row.주문번호;
        if (!acc[id]) acc[id] = [];
        acc[id].push(row);
        return acc;
      }, {} as Record<string, OrderRow[]>);

      const deliveryRecords = Object.entries(groupedByOrder).map(([orderId, orders]) => {
        const base = orders[0];
        const items = orders.map(row => {
          const item = row.상품명 || '';
          const opt = row.옵션 || '';
          const qty = Number(row.수량);
          let res = opt ? `${item}(${opt})` : item;
          if (qty > 1) res += ` * ${qty}`;
          return res;
        });

        const totalQty = orders.reduce((sum, row) => sum + Number(row.수량), 0);

        const record: any = {
          '수령인성명': base.수령인,
          '수령인전화번호': base.전화번호,
          '수령인가타연락처': base.핸드폰 || base.전화번호,
          '수령인주소(전체, 분할)': base.주소,
          '박스수량': 1,
        };

        for (let i = 0; i < 15; i++) {
          record[`품목명${i + 1}`] = items[i] || '';
        }

        record['개인별총수량'] = totalQty;
        record['배송메세지'] = base.배송메세지;
        record['보내는분성명'] = '예진상사 칼린';
        record['보내는분전화번호'] = '02)3469-2632';
        record['보내는분주소(전체, 분활)'] = '경기도 군포시 공단로 278-19 (금정동) 3층';
        record['주문번호'] = orderId;
        record['배송번호'] = '';

        return record;
      });

      // 5. ERP Transformation
      const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const erpCode = STORE_MAPPING[selectedMall] || selectedMall;

      const erpRecords = allOrders.map(row => ({
        '날짜': todayStr,
        '매장': erpCode,
        '품번': row.스타일넘버,
        '칼라': extractColorCode(row.옵션),
        '사이즈': 'zz',
        '기타': '',
        '주문수량': row.수량,
        '판매가': row.판매가,
        '스타일넘버': row.스타일넘버,
        '옵션': row.옵션
      }));

      // Generate files
      downloadXLSX(deliveryRecords, `2번_${selectedMall}_택배변환.xlsx`);
      downloadXLSX(erpRecords, `5번_${selectedMall}_ERP변환.xlsx`);

      addLog(`Exported ${selectedMall} delivery and ERP files successfully.`, 'success');
      setIsProcessing(false);
    } catch (err) {
      console.error(err);
      setError('파일 처리 중 오류가 발생했습니다.');
      addLog('Error during order sheet transformation.', 'warn');
      setIsProcessing(false);
    }
  };

  const handleTask2Process = async () => {
    if (!task2ProcessedFile || !task2InvoiceFile) {
      setError('두 파일 모두 선택해주세요.');
      return;
    }
    setIsProcessing(true);
    setError(null);

    try {
      addLog('Initiating CJ Invoice stream integration...', 'info');
      const df2Raw = await readFile(task2ProcessedFile);
      const df3Raw = await readFile(task2InvoiceFile);

      const df2 = standardizeWeb(df2Raw);
      const df3 = standardizeWeb(df3Raw);

      const merged = df2.filter(row2 => df3.some(row3 => row3['주문번호'] === row2['주문번호']))
                        .map(row2 => {
                          const row3 = df3.find(r => r['주문번호'] === row2['주문번호']);
                          return { ...row2, ...row3 };
                        });

      if (merged.length === 0) {
        setError('결합할 데이터가 없습니다. 주문번호가 일치하는지 확인해주세요.');
        addLog('Merge failed: No matching order IDs found.', 'warn');
        setIsProcessing(false);
        return;
      }

      const uploadRecords = merged.map(row => ({
        '주문번호': row['주문번호'],
        '운송장번호': row['운송장번호'] || '',
        '인수자': row['수령인성명'] || row['수령인'] || '',
        '인수자TEL1': row['수령인전화번호'] || row['전화번호'] || '',
        '인수자TEL2': row['수령인가타연락처'] || row['핸드폰'] || '',
        '구주소': '',
        '신주소': row['수령인주소(전체, 분할)'] || row['주소'] || '',
        '받는주소': row['수령인주소(전체, 분할)'] || row['주소'] || ''
      }));

      downloadXLSX(uploadRecords, `4번_${selectedMall}_업로드양식.xlsx`);
      addLog(`Integrated ${merged.length} invoice records successfully.`, 'success');
      setIsProcessing(false);
    } catch (err) {
      console.error(err);
      setError('파일 결합 중 오류가 발생했습니다.');
      addLog('Error during data stream integration.', 'warn');
      setIsProcessing(false);
    }
  };

  const readFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target?.result;
        try {
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const json = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
          resolve(json);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsBinaryString(file);
    });
  };

  const standardizeWeb = (data: any[]): any[] => {
    return data.map(row => {
      const cleanRow: any = {};
      Object.keys(row).forEach(key => {
        const k = key.replace(/\s/g, '').trim();
        let val = row[key];
        if (['주문번호', '고객주문번호', '상품주문번호'].includes(k)) {
          cleanRow['주문번호'] = String(val).replace(/\.0$/, '').trim();
        } else {
          cleanRow[k] = val;
        }
      });
      return cleanRow;
    });
  };

  const downloadXLSX = (data: any[], fileName: string) => {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, fileName);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-slate-300 font-sans selection:bg-[#C4A484]/30 flex flex-col p-6 sm:p-10">
      <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col">
        
        {/* Header Section */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 border-b border-white/10 pb-8 gap-6">
          <div className="flex items-center gap-5">
            <div 
              onClick={resetState}
              className="w-12 h-12 bg-gradient-to-tr from-[#C4A484] to-[#8B7355] rounded-sm flex items-center justify-center font-serif text-[#0A0A0C] font-bold text-2xl cursor-pointer shadow-lg shadow-[#C4A484]/10 transition-transform active:scale-95"
            >
              C
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-light tracking-[0.2em] text-white">CARLYN <span className="text-[#C4A484] font-medium">SYSTEM</span></h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-[0.3em] mt-1 font-mono">Online Order Processing Unit v2.4</p>
            </div>
          </div>
          <div className="text-right flex flex-col items-end">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1.5 opacity-60">System Operational Time</div>
            <div className="text-sm font-mono text-white/90 tabular-nums">{new Date().toLocaleString()}</div>
          </div>
        </header>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-10">
          
          {/* Sidebar Area */}
          <aside className="lg:col-span-3 flex flex-col gap-6">
            <div className="bg-[#141418] border border-white/5 rounded-xl p-6 shadow-inner">
              <h3 className="text-[#C4A484] text-[10px] font-bold uppercase tracking-[0.2em] mb-5 border-b border-white/5 pb-3">Active Mappings</h3>
              <div className="space-y-3.5 font-mono text-[11px]">
                {Object.entries(STORE_MAPPING).slice(0, 7).map(([name, code]) => (
                  <div key={name} className="flex justify-between items-center group cursor-default">
                    <span className="text-slate-500 group-hover:text-slate-300 transition-colors uppercase">{name}</span> 
                    <span className="text-white/80 group-hover:text-[#C4A484] transition-colors">{code}</span>
                  </div>
                ))}
                <div className="pt-2 text-[9px] text-slate-600 italic">...plus others</div>
              </div>
            </div>
            
            <div className="flex-1 bg-gradient-to-b from-[#141418] to-[#0A0A0C] border border-white/5 rounded-xl p-6">
              <h3 className="text-[#C4A484] text-[10px] font-bold uppercase tracking-[0.2em] mb-5">Process Health</h3>
              <div className="space-y-6">
                <div className="relative pt-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">Throughput Capacity</span>
                    <span className="text-[10px] text-[#C4A484] font-mono">94%</span>
                  </div>
                  <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: "94%" }}
                      className="h-full bg-[#C4A484] shadow-[0_0_8px_#C4A484]" 
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]"></div>
                  <span>Standardizer Ready</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></div>
                  <span>Vite Integration Online</span>
                </div>
              </div>
            </div>
          </aside>

          {/* Main Action Panel */}
          <main className="lg:col-span-9 flex flex-col gap-8">
            <AnimatePresence mode="wait">
              {mode === 'NONE' ? (
                <motion.div 
                  key="home"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.02 }}
                  className="grid sm:grid-cols-2 gap-8 flex-1"
                >
                  <button 
                    onClick={() => setMode('TASK_1_5')}
                    className="group relative flex flex-col justify-between text-left p-10 bg-[#141418] border border-white/10 rounded-2xl transition-all hover:border-[#C4A484]/40 hover:bg-[#1A1A22] shadow-xl"
                  >
                    <div>
                      <div className="text-[#C4A484] mb-8 bg-black/40 w-16 h-16 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110">
                        <FileText className="w-8 h-8" strokeWidth={1.5} />
                      </div>
                      <h2 className="text-2xl font-light text-white mb-4 tracking-tight italic font-serif">Order Sheet Transformation</h2>
                      <p className="text-sm text-slate-500 leading-relaxed font-light">
                        Extract and refine source data from Naver, Musinsa, and others. Generates localized delivery manifests (Task 2) and central ERP integration streams (Task 5).
                      </p>
                    </div>
                    <div className="mt-10 flex items-center justify-between">
                      <span className="text-[10px] border-b border-[#C4A484]/30 pb-0.5 uppercase tracking-[0.2em] text-slate-500 group-hover:text-[#C4A484] transition-colors">Initialize Module</span>
                      <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-[#C4A484] transition-all group-hover:translate-x-1" />
                    </div>
                  </button>

                  <button 
                    onClick={() => setMode('TASK_2_4')}
                    className="group relative flex flex-col justify-between text-left p-10 bg-[#141418] border border-white/10 rounded-2xl transition-all hover:border-[#C4A484]/40 hover:bg-[#1A1A22] shadow-xl"
                  >
                    <div>
                      <div className="text-[#C4A484] mb-8 bg-black/40 w-16 h-16 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110">
                        <Truck className="w-8 h-8" strokeWidth={1.5} />
                      </div>
                      <h2 className="text-2xl font-light text-white mb-4 tracking-tight italic font-serif">Logistics Synchronization</h2>
                      <p className="text-sm text-slate-500 leading-relaxed font-light">
                        Align processed manifests with third-party CJ Logistics tracking signatures. Prepares the verified final stream for automated store portal updates (Task 4).
                      </p>
                    </div>
                    <div className="mt-10 flex items-center justify-between">
                      <span className="text-[10px] border-b border-[#C4A484]/30 pb-0.5 uppercase tracking-[0.2em] text-slate-500 group-hover:text-[#C4A484] transition-colors">Merge Streams</span>
                      <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-[#C4A484] transition-all group-hover:translate-x-1" />
                    </div>
                  </button>
                </motion.div>
              ) : (
                <motion.div 
                  key="task"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-[#141418] rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col h-full"
                >
                  <div className="px-8 h-20 border-b border-white/5 flex items-center justify-between bg-black/20">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={resetState}
                        className="p-2.5 hover:bg-white/5 rounded-lg transition-colors group"
                      >
                        <ArrowRight className="w-5 h-5 rotate-180 text-slate-500 group-hover:text-[#C4A484]" />
                      </button>
                      <h3 className="font-serif italic text-lg text-white">
                        {mode === 'TASK_1_5' ? 'Transformation Module' : 'Synchronization Module'}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                       <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mr-2">Operational Status</span>
                       <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></div>
                    </div>
                  </div>

                  <div className="p-10 space-y-12 overflow-y-auto">
                    <div className="space-y-4">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-[#C4A484]" /> Target Outlet Selection
                      </label>
                      <div className="relative">
                        <select 
                          value={selectedMall}
                          onChange={(e) => setSelectedMall(e.target.value)}
                          className="w-full h-14 px-6 rounded-xl border border-white/5 bg-[#0A0A0C] text-white text-sm focus:ring-1 focus:ring-[#C4A484]/50 focus:border-[#C4A484]/30 transition-all outline-none appearance-none cursor-pointer font-light"
                        >
                          {Object.keys(STORE_MAPPING).map(mall => (
                            <option key={mall} value={mall}>{mall}</option>
                          ))}
                        </select>
                        <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-600">
                          <ArrowRight className="w-4 h-4 rotate-90" />
                        </div>
                      </div>
                    </div>

                    {mode === 'TASK_1_5' ? (
                      <div className="space-y-4">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                          <Download className="w-3.5 h-3.5 text-[#C4A484]" /> Order Sheet Repositories
                        </label>
                        <FileUploadArea 
                          onFilesSelected={(files) => setTask1Files(prev => [...prev, ...files])}
                          files={task1Files}
                          onRemove={(index) => setTask1Files(prev => prev.filter((_, i) => i !== index))}
                          multiple
                        />
                      </div>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-8">
                        <div className="space-y-4">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Manifest (2)</label>
                          <FileUploadArea 
                            onFilesSelected={(files) => setTask2ProcessedFile(files[0])}
                            files={task2ProcessedFile ? [task2ProcessedFile] : []}
                            onRemove={() => setTask2ProcessedFile(null)}
                          />
                        </div>
                        <div className="space-y-4">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">CJ Tracking (3)</label>
                          <FileUploadArea 
                            onFilesSelected={(files) => setTask2InvoiceFile(files[0])}
                            files={task2InvoiceFile ? [task2InvoiceFile] : []}
                            onRemove={() => setTask2InvoiceFile(null)}
                          />
                        </div>
                      </div>
                    )}

                    {error && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="p-5 rounded-xl bg-red-950/20 text-red-400 text-xs flex items-start gap-4 border border-red-900/30"
                      >
                        <AlertCircle className="w-5 h-5 shrink-0 opacity-80" />
                        <span className="font-light">{error}</span>
                      </motion.div>
                    )}

                    <button
                      disabled={isProcessing}
                      onClick={mode === 'TASK_1_5' ? handleTask1Process : handleTask2Process}
                      className={cn(
                        "w-full h-16 rounded-xl font-medium tracking-widest text-xs uppercase flex items-center justify-center gap-4 transition-all transform active:scale-[0.99] border",
                        isProcessing 
                          ? "bg-white/5 text-slate-600 border-white/5 cursor-not-allowed" 
                          : "bg-gradient-to-r from-[#C4A484] to-[#8B7355] text-black border-transparent shadow-xl shadow-[#C4A484]/5 hover:brightness-110"
                      )}
                    >
                      {isProcessing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-slate-700 border-t-[#C4A484] rounded-full animate-spin" />
                          Processing Streams...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          Execute & Export Data
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="h-44 bg-[#070709] border border-white/5 rounded-xl p-6 font-mono text-[10px] overflow-hidden flex flex-col shadow-inner">
              <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-2">
                <span className="text-slate-600 uppercase tracking-[0.3em]">System Log Console</span>
                <span className="text-emerald-900/60 font-bold">STABLE ONLINE</span>
              </div>
              <div className="space-y-1.5 overflow-y-auto custom-scrollbar flex-1 pr-2">
                {logs.length > 0 ? logs.map((log, i) => (
                  <p key={i} className="flex gap-4">
                    <span className="text-slate-700 whitespace-nowrap">[{log.time}]</span>
                    <span className={cn(
                      "uppercase tracking-tighter whitespace-nowrap",
                      log.type === 'success' ? 'text-emerald-500' : 
                      log.type === 'warn' ? 'text-amber-500' : 'text-blue-500'
                    )}>
                      {log.type}:
                    </span>
                    <span className="text-slate-400 font-light italic">{log.msg}</span>
                  </p>
                )) : (
                  <p className="text-slate-700 italic">No recent activity logged.</p>
                )}
              </div>
            </div>
          </main>
        </div>

        <footer className="mt-12 pt-8 border-t border-white/5 flex flex-col sm:flex-row justify-between items-end gap-6 opacity-60 hover:opacity-100 transition-opacity">
          <div className="text-[10px] text-slate-600 tracking-widest font-mono">
            COPYRIGHT © YEJIN SANGSA. LEE JI-WON. ALL RIGHTS RESERVED.
          </div>
          <div className="flex gap-10">
            <div className="flex flex-col items-end">
              <span className="text-[9px] uppercase tracking-widest text-[#C4A484] mb-1">Direct Inquiry</span>
              <span className="text-xs text-white font-mono">02-3469-2632</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[9px] uppercase tracking-widest text-[#C4A484] mb-1">Logistics Depot</span>
              <span className="text-xs text-white text-right font-light italic">GUNPO WAREHOUSE 3F</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function FileUploadArea({ onFilesSelected, files, onRemove, multiple = false }: {
  onFilesSelected: (files: File[]) => void;
  files: File[];
  onRemove: (index: number) => void;
  multiple?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      onFilesSelected(multiple ? droppedFiles : [droppedFiles[0]]);
    }
  };

  return (
    <div className="space-y-4">
      <div 
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "h-28 rounded-xl border border-dashed border-white/10 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all bg-black/10 group",
          "hover:border-[#C4A484]/40 hover:bg-[#C4A484]/5"
        )}
      >
        <Upload className="w-5 h-5 text-slate-600 group-hover:text-[#C4A484] transition-colors" />
        <span className="text-[10px] font-bold text-slate-600 group-hover:text-slate-400 uppercase tracking-widest">
          {multiple ? 'Deploy Local Streams' : 'Deploy Stream'}
        </span>
        <input 
          ref={fileInputRef}
          type="file" 
          multiple={multiple}
          className="hidden" 
          onChange={(e) => {
            const selected = Array.from(e.target.files || []);
            if (selected.length > 0) onFilesSelected(selected);
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, idx) => (
            <div key={idx} className="flex items-center justify-between p-3.5 bg-black/20 rounded-xl border border-white/5">
              <div className="flex items-center gap-3 truncate">
                <FileSpreadsheet className="w-4 h-4 text-[#C4A484] shrink-0" />
                <span className="text-[11px] font-mono text-slate-300 truncate">{file.name}</span>
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(idx);
                }}
                className="p-1.5 hover:bg-white/5 rounded-lg text-slate-600 hover:text-[#C4A484] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
