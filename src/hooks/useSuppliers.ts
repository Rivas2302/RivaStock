import { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { callRpc } from '../lib/db';
import { supabase } from '../lib/supabase';
import { Supplier } from '../types';

export function useSuppliers() {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSuppliers = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('suppliers')
      .select('*')
      .eq('user_id', user.uid)
      .order('name_lower');
    if (data) {
      const mapped = data.map((r: Record<string, unknown>) => ({
        id: r.id,
        ownerUid: r.user_id,
        name: r.name,
        nameLower: r.name_lower,
        contactName: r.contact_name,
        phone: r.phone,
        email: r.email,
        address: r.address,
        cuit: r.cuit,
        category: r.category,
        notes: r.notes,
        paymentTerms: r.payment_terms,
        catalogUrl: r.catalog_url,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      } as Supplier));
      setSuppliers(mapped.sort((a, b) => a.name.localeCompare(b.name)));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      await fetchSuppliers();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [user]);

  const createSupplier = async (
    name: string,
    contactName?: string,
    phone?: string,
    email?: string,
    address?: string,
    cuit?: string,
    category?: string,
    notes?: string,
    paymentTerms?: string,
    catalogUrl?: string,
  ): Promise<Supplier> => {
    const result = await callRpc<Supplier>('register_supplier', {
      p_name:          name,
      p_contact_name:  contactName  ?? null,
      p_phone:         phone        ?? null,
      p_email:         email        ?? null,
      p_address:       address      ?? null,
      p_cuit:          cuit         ?? null,
      p_category:      category     ?? null,
      p_notes:         notes        ?? null,
      p_payment_terms: paymentTerms  ?? null,
      p_catalog_url:   catalogUrl    ?? null,
    });
    await fetchSuppliers();
    return result;
  };

  const updateSupplier = async (
    id: string,
    name: string,
    contactName?: string,
    phone?: string,
    email?: string,
    address?: string,
    cuit?: string,
    category?: string,
    notes?: string,
    paymentTerms?: string,
    catalogUrl?: string,
  ): Promise<Supplier> => {
    const result = await callRpc<Supplier>('update_supplier', {
      p_id:           id,
      p_name:         name,
      p_contact_name: contactName  ?? null,
      p_phone:        phone        ?? null,
      p_email:        email        ?? null,
      p_address:      address      ?? null,
      p_cuit:         cuit         ?? null,
      p_category:     category     ?? null,
      p_notes:        notes        ?? null,
      p_payment_terms: paymentTerms ?? null,
      p_catalog_url:  catalogUrl    ?? null,
    });
    await fetchSuppliers();
    return result;
  };

  const deleteSupplier = async (id: string): Promise<void> => {
    await callRpc<void>('delete_supplier', { p_id: id });
    await fetchSuppliers();
  };

  const toggleSupplierActive = async (id: string): Promise<Supplier> => {
    const result = await callRpc<Supplier>('toggle_supplier_active', { p_id: id });
    await fetchSuppliers();
    return result;
  };

  return {
    suppliers,
    loading,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    toggleSupplierActive,
    refetch: fetchSuppliers,
  };
}