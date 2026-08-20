import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const INFINITEPAY_HANDLE = "raul-fabian-arevalo";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fonte da verdade dos preços/estoque no servidor — nunca confiar no valor
// enviado pelo navegador. Precisa ficar em sincronia com o array PRODUCTS
// de index.html sempre que um preço, cor ou estoque mudar.
const CATALOG: Record<string, { price: number; stock: number }> = {
  "KO-2001": { price: 899, stock: 34 },
  "KO-2002": { price: 799, stock: 41 },
  "KO-2003": { price: 849, stock: 19 },
};

const TIERS = [
  { min: 100, d: 0.45 },
  { min: 60, d: 0.38 },
  { min: 30, d: 0.32 },
  { min: 10, d: 0.25 },
];
const MIN_B2B = 10;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado." }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Não autenticado." }, 401);

    const { cart, mode, redirect_url } = await req.json();
    if (!Array.isArray(cart) || !cart.length) return json({ error: "Carrinho vazio." }, 400);
    if (mode !== "varejo" && mode !== "atacado") return json({ error: "Modo inválido." }, 400);

    if (mode === "atacado") {
      const { data: reseller } = await supabase
        .from("resellers")
        .select("status")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!reseller || reseller.status === "pending" || reseller.status === "rejected") {
        return json({ error: "Cadastro de revenda não aprovado." }, 403);
      }
    }

    let totalUnits = 0;
    let subtotal = 0;
    const stockNeeded: Record<string, number> = {};
    const lineItems: { quantity: number; unitPrice: number; description: string }[] = [];

    for (const raw of cart) {
      const sku = String(raw?.sku || "");
      const qty = Number(raw?.qty);
      const catalog = CATALOG[sku];
      if (!catalog) return json({ error: `Produto inválido: ${sku}` }, 400);
      if (!Number.isInteger(qty) || qty < 1) return json({ error: `Quantidade inválida para ${sku}` }, 400);

      stockNeeded[sku] = (stockNeeded[sku] || 0) + qty;
      if (stockNeeded[sku] > catalog.stock) return json({ error: `Estoque insuficiente para ${sku}` }, 409);

      totalUnits += qty;
      subtotal += catalog.price * qty;
      lineItems.push({ quantity: qty, unitPrice: catalog.price, description: `${sku} - ${String(raw?.color || "")}` });
    }

    if (mode === "atacado" && totalUnits < MIN_B2B) {
      return json({ error: `Pedido mínimo de atacado é ${MIN_B2B} peças.` }, 400);
    }

    let discount = 0;
    if (mode === "atacado") {
      for (const t of TIERS) {
        if (totalUnits >= t.min) { discount = t.d; break; }
      }
    }

    const afterDiscount = subtotal * (1 - discount);
    const shipping = afterDiscount >= 899 ? 0 : 39.9;
    const total = afterDiscount + shipping;

    const items = lineItems.map((l) => ({
      quantity: l.quantity,
      price: Math.round(l.unitPrice * (1 - discount) * 100),
      description: l.description,
    }));
    if (shipping > 0) items.push({ quantity: 1, price: Math.round(shipping * 100), description: "Frete" });

    const order_nsu = crypto.randomUUID();

    const r = await fetch("https://api.checkout.infinitepay.io/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle: INFINITEPAY_HANDLE,
        items,
        order_nsu,
        redirect_url,
        customer: { email: user.email },
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.url) return json({ error: "Não foi possível iniciar o pagamento." }, 502);

    return json({ url: data.url, order_nsu, total, mode });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
