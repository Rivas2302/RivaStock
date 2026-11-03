-- D1: cover missing foreign keys on business, Facebook, AI, and knowledge tables
-- with production rows or sustained query activity.
-- Out-of-scope ancillary and empty, low-activity tables remain for later review.

-- ai_bridge_devices.ai_bridge_devices_current_job_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_ai_bridge_devices_current_job_id" ON public."ai_bridge_devices" ("current_job_id");

-- ai_bridge_workers.ai_bridge_workers_current_job_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_ai_bridge_workers_current_job_id" ON public."ai_bridge_workers" ("current_job_id");

-- ai_central_status.ai_central_status_device_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_ai_central_status_device_id" ON public."ai_central_status" ("device_id");

-- ai_chat_messages.ai_chat_messages_user_id_job_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_ai_chat_messages_user_id_job_id" ON public."ai_chat_messages" ("user_id", "job_id");

-- attributed_sale_commands.attributed_sale_commands_sale_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_attributed_sale_commands_user_id_sale_id" ON public."attributed_sale_commands" ("user_id", "sale_id");

-- cash_flow.cash_flow_financial_command_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_cash_flow_financial_command_id" ON public."cash_flow" ("financial_command_id");

-- cash_flow_allocations.cash_flow_allocations_cash_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_cash_flow_allocations_user_id_cash_flow_id" ON public."cash_flow_allocations" ("user_id", "cash_flow_id");

-- cash_flow_allocations.cash_flow_allocations_owner_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_cash_flow_allocations_user_id_inventory_owner_id" ON public."cash_flow_allocations" ("user_id", "inventory_owner_id");

-- facebook_deliveries.facebook_active_attempt_fk
CREATE INDEX IF NOT EXISTS "idx_d1_facebook_deliveries_active_attempt_id" ON public."facebook_deliveries" ("active_attempt_id");

-- facebook_deliveries.facebook_deliveries_device_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_facebook_deliveries_device_id" ON public."facebook_deliveries" ("device_id");

-- facebook_delivery_decisions.facebook_delivery_decisions_delivery_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_facebook_delivery_decisions_delivery_id" ON public."facebook_delivery_decisions" ("delivery_id");

-- facebook_delivery_reviews.facebook_delivery_reviews_delivery_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_facebook_delivery_reviews_delivery_id" ON public."facebook_delivery_reviews" ("delivery_id");

-- facebook_devices.facebook_devices_user_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_facebook_devices_user_id" ON public."facebook_devices" ("user_id");

-- facebook_group_sync.facebook_group_sync_device_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_facebook_group_sync_device_id" ON public."facebook_group_sync" ("device_id");

-- facebook_publications.facebook_publications_product_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_facebook_publications_product_id" ON public."facebook_publications" ("product_id");

-- facebook_publications.facebook_publications_repeat_of_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_facebook_publications_repeat_of" ON public."facebook_publications" ("repeat_of");

-- inventory_owner_memberships.inventory_owner_memberships_actor_uid_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_inventory_owner_memberships_actor_uid" ON public."inventory_owner_memberships" ("actor_uid");

-- inventory_owner_memberships.inventory_owner_memberships_owner_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_inventory_owner_memberships_user_id_inventory_owner_id" ON public."inventory_owner_memberships" ("user_id", "inventory_owner_id");

-- inventory_product_commands.inventory_product_commands_actor_uid_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_inventory_product_commands_actor_uid" ON public."inventory_product_commands" ("actor_uid");

-- inventory_stock_commands.inventory_stock_commands_actor_uid_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_inventory_stock_commands_actor_uid" ON public."inventory_stock_commands" ("actor_uid");

-- knowledge_ai_proposals.knowledge_ai_proposals_user_id_job_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_ai_proposals_user_id_job_id" ON public."knowledge_ai_proposals" ("user_id", "job_id");

-- knowledge_chunks.knowledge_chunks_user_id_version_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_chunks_user_id_version_id" ON public."knowledge_chunks" ("user_id", "version_id");

-- knowledge_document_versions.knowledge_document_versions_created_by_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_document_versions_created_by" ON public."knowledge_document_versions" ("created_by");

-- knowledge_document_versions.knowledge_document_versions_transfer_worker_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_document_versions_transfer_worker_id" ON public."knowledge_document_versions" ("transfer_worker_id");

-- knowledge_documents.knowledge_documents_created_by_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_documents_created_by" ON public."knowledge_documents" ("created_by");

-- knowledge_documents.knowledge_documents_indexed_job_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_documents_indexed_job_id" ON public."knowledge_documents" ("indexed_job_id");

-- knowledge_documents.knowledge_documents_updated_by_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_documents_updated_by" ON public."knowledge_documents" ("updated_by");

-- knowledge_documents.knowledge_documents_user_id_category_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_documents_user_id_category_id" ON public."knowledge_documents" ("user_id", "category_id");

-- knowledge_documents.knowledge_documents_user_id_current_version_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_documents_user_id_current_version_id" ON public."knowledge_documents" ("user_id", "current_version_id");

-- knowledge_documents.knowledge_documents_user_id_indexed_version_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_documents_user_id_indexed_version_id" ON public."knowledge_documents" ("user_id", "indexed_version_id");

-- knowledge_documents.knowledge_documents_user_id_published_version_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_documents_user_id_published_version_id" ON public."knowledge_documents" ("user_id", "published_version_id");

-- knowledge_file_requests.knowledge_file_requests_requested_by_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_file_requests_requested_by" ON public."knowledge_file_requests" ("requested_by");

-- knowledge_index_jobs.knowledge_index_jobs_user_id_document_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_index_jobs_user_id_document_id" ON public."knowledge_index_jobs" ("user_id", "document_id");

-- knowledge_index_jobs.knowledge_index_jobs_user_id_version_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_knowledge_index_jobs_user_id_version_id" ON public."knowledge_index_jobs" ("user_id", "version_id");

-- price_list_items.price_list_items_user_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_price_list_items_user_id" ON public."price_list_items" ("user_id");

-- quotes.quotes_client_fk
CREATE INDEX IF NOT EXISTS "idx_d1_quotes_client_id" ON public."quotes" ("client_id");

-- quotes.quotes_converted_to_sale_id_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_quotes_converted_to_sale_id" ON public."quotes" ("converted_to_sale_id");

-- sale_item_allocations.sale_item_allocations_holding_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_sale_item_allocations_user_id_inventory_holding_id" ON public."sale_item_allocations" ("user_id", "inventory_holding_id");

-- sale_item_allocations.sale_item_allocations_item_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_sale_item_allocations_user_id_sale_item_id" ON public."sale_item_allocations" ("user_id", "sale_item_id");

-- sale_item_allocations.sale_item_allocations_owner_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_sale_item_allocations_user_id_inventory_owner_id" ON public."sale_item_allocations" ("user_id", "inventory_owner_id");

-- sale_item_allocations.sale_item_allocations_sale_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_sale_item_allocations_user_id_sale_id" ON public."sale_item_allocations" ("user_id", "sale_id");

-- sale_items.sale_items_product_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_sale_items_user_id_product_id" ON public."sale_items" ("user_id", "product_id");

-- sale_items.sale_items_sale_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_sale_items_user_id_sale_id" ON public."sale_items" ("user_id", "sale_id");

-- sales.sales_product_fk
CREATE INDEX IF NOT EXISTS "idx_d1_sales_product_id" ON public."sales" ("product_id");

-- stock_intakes.stock_intakes_actor_uid_fkey
CREATE INDEX IF NOT EXISTS "idx_d1_stock_intakes_actor_uid" ON public."stock_intakes" ("actor_uid");

-- stock_intakes.stock_intakes_inventory_owner_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_stock_intakes_user_id_inventory_owner_id" ON public."stock_intakes" ("user_id", "inventory_owner_id");

-- stock_intakes.stock_intakes_product_fk
CREATE INDEX IF NOT EXISTS "idx_d1_stock_intakes_product_id" ON public."stock_intakes" ("product_id");

-- stock_movements.stock_movements_allocation_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_stock_movements_user_id_sale_item_allocation_id" ON public."stock_movements" ("user_id", "sale_item_allocation_id");

-- stock_movements.stock_movements_item_tenant_fk
CREATE INDEX IF NOT EXISTS "idx_d1_stock_movements_user_id_sale_item_id" ON public."stock_movements" ("user_id", "sale_item_id");
