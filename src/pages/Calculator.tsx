import { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { PriceRange, Product } from '../types';
import { formatCurrency, cn } from '../lib/utils';
import { 
  Calculator as CalcIcon, 
  Plus, 
  Trash2, 
  Save, 
  ArrowRight, 
  Check, 
  AlertCircle,
  Copy,
  Table as TableIcon
} from 'lucide-react';
import Modal from '../components/Modal';
import { motion } from 'motion/react';

export default function Calculator() {
  const { user } = useAuth();
  const [priceRanges, setPriceRanges] = useState<PriceRange[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Single Calc State
  const [purchasePrice, setPurchasePrice] = useState<number>(0);
  const [suggestedPrice, setSuggestedPrice] = useState<number>(0);
  const [appliedRange, setAppliedRange] = useState<PriceRange | null>(null);
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');

  // Batch Calc State
  const [batchInput, setBatchInput] = useState('');
  const [batchResults, setBatchResults] = useState<any[]>([]);

  const fetchData = async () => {
    if (!user) return;
    const [pr, p] = await Promise.all([
      db.list<PriceRange>('price_ranges', user.uid),
      db.list<Product>('products', user.uid)
    ]);
    setPriceRanges(pr.sort((a, b) => a.minPrice - b.minPrice));
    setProducts(p);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  useEffect(() => {
    const purchase = Number(purchasePrice) || 0;
    const range = priceRanges.find(r => 
      purchase >= r.minPrice && (r.maxPrice === null || purchase <= r.maxPrice)
    );
    if (range) {
      const markup = range.markupPercent / 100;
      setSuggestedPrice(Math.ceil(purchase * (1 + markup)));
      setAppliedRange(range);
    } else {
      setSuggestedPrice(0);
      setAppliedRange(null);
    }
  }, [purchasePrice, priceRanges]);

  const handleBatchCalc = () => {
    const lines = batchInput.split('\n').filter(l => l.trim() !== '');
    const results = lines.map(line => {
      const purchase = Number(line.replace(/[^0-9.]/g, '')) || 0;
      const range = priceRanges.find(r => 
        purchase >= r.minPrice && (r.maxPrice === null || purchase <= r.maxPrice)
      );
      if (range) {
        const markup = range.markupPercent / 100;
        const sale = Math.ceil(purchase * (1 + markup));
        const profit = sale - purchase;
        const margin = (profit / sale) * 100;
        return { purchase, range, sale, profit, margin };
      }
      return { purchase, range: null, sale: 0, profit: 0, margin: 0 };
    });
    setBatchResults(results);
  };

  const handleApplyToProduct = async () => {
    if (!selectedProductId || !suggestedPrice) return;
    await db.update<Product>('products', selectedProductId, { salePrice: suggestedPrice });
    setIsApplyModalOpen(false);
    setSelectedProductId('');
    alert('Precio actualizado correctamente');
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Calculadora de Precios</h2>
        <p className="text-slate-500 dark:text-slate-400">Calcula precios de venta basados en tus rangos configurados</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Single Calculator */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-6">
            <CalcIcon className="text-indigo-600" size={20} />
            <h3 className="font-bold text-slate-900 dark:text-white">Calculadora Individual</h3>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Precio de Compra</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                <input 
                  type="number"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(Number(e.target.value))}
                  className="w-full pl-8 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white text-lg font-bold"
                  placeholder="0"
                />
              </div>
            </div>

            <div className="p-6 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800/50">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Precio de Venta Sugerido</span>
                {appliedRange && (
                  <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-bold uppercase">
                    Rango: {appliedRange.markupPercent}%
                  </span>
                )}
              </div>
              <p className="text-4xl font-black text-indigo-600 dark:text-indigo-400">
                {formatCurrency(suggestedPrice)}
              </p>
              
              {appliedRange ? (
                <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-indigo-200 dark:border-indigo-800">
                  <div>
                    <p className="text-[10px] font-bold text-indigo-400 uppercase">Ganancia</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatCurrency(suggestedPrice - purchasePrice)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-indigo-400 uppercase">Margen</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                      {suggestedPrice > 0 ? (((suggestedPrice - purchasePrice) / suggestedPrice) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex items-center gap-2 text-rose-500 text-sm font-medium">
                  <AlertCircle size={16} />
                  <span>No hay un rango definido para este precio</span>
                </div>
              )}
            </div>

            <button 
              disabled={!suggestedPrice}
              onClick={() => setIsApplyModalOpen(true)}
              className="w-full bg-slate-900 dark:bg-white dark:text-slate-900 text-white py-3 rounded-xl font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save size={20} />
              Aplicar a Producto
            </button>
          </div>
        </div>

        {/* Batch Calculator */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-6">
            <TableIcon className="text-indigo-600" size={20} />
            <h3 className="font-bold text-slate-900 dark:text-white">Calculadora en Lote</h3>
          </div>

          <div className="space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">Pega múltiples precios de compra (uno por línea) para calcular masivamente.</p>
            <textarea 
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              className="w-full h-32 px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white resize-none font-mono text-sm"
              placeholder="1500&#10;2500&#10;12000"
            />
            <button 
              onClick={handleBatchCalc}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2"
            >
              <CalcIcon size={20} />
              Calcular Lote
            </button>

            {batchResults.length > 0 && (
              <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-bold uppercase">
                    <tr>
                      <th className="px-3 py-2">Compra</th>
                      <th className="px-3 py-2">Venta</th>
                      <th className="px-3 py-2">Margen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {batchResults.map((res, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2 dark:text-slate-300">{formatCurrency(res.purchase)}</td>
                        <td className="px-3 py-2 font-bold dark:text-white">{res.sale > 0 ? formatCurrency(res.sale) : 'N/A'}</td>
                        <td className={cn(
                          "px-3 py-2 font-bold",
                          res.margin > 50 ? "text-emerald-500" : res.margin >= 20 ? "text-amber-500" : "text-rose-500"
                        )}>
                          {res.margin.toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Apply Modal */}
      <Modal 
        isOpen={isApplyModalOpen} 
        onClose={() => setIsApplyModalOpen(false)} 
        title="Aplicar Precio a Producto"
      >
        <div className="space-y-6">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Selecciona el producto al que deseas aplicar el precio de venta de <span className="font-bold text-indigo-600 dark:text-indigo-400">{formatCurrency(suggestedPrice)}</span>.
          </p>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Producto</label>
            <select 
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
            >
              <option value="">Seleccionar producto</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name} (Actual: {formatCurrency(p.salePrice)})</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button 
              onClick={() => setIsApplyModalOpen(false)}
              className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button 
              disabled={!selectedProductId}
              onClick={handleApplyToProduct}
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
            >
              Confirmar Cambio
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
