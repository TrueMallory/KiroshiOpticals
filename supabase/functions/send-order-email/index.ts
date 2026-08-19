import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_ADDRESS = Deno.env.get("ORDER_EMAIL_FROM") || "Kiroshi Opticals <onboarding@resend.dev>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function brl(v: number) {
  return "R$ " + Number(v).toFixed(2).replace(".", ",");
}

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, name, order_nsu, items, total } = await req.json();

    if (!email || !Array.isArray(items) || !items.length) {
      return new Response(JSON.stringify({ error: "missing email or items" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const itemsHtml = items
      .map((i: any) => `<li>${i.qty}x ${esc(i.name)} (${esc(i.sku)}) — ${esc(i.color)}</li>`)
      .join("");

    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="font-weight:500">Pedido confirmado — Kiroshi Opticals</h2>
        <p>Olá${name ? " " + esc(name) : ""}, seu pagamento foi confirmado. Aqui está o resumo do seu pedido:</p>
        <ul style="line-height:1.6">${itemsHtml}</ul>
        <p style="font-size:18px"><strong>Total: ${brl(total)}</strong></p>
        <p style="color:#888;font-size:13px">Pedido: ${esc(order_nsu || "-")}</p>
        <p>Obrigado pela compra!</p>
      </div>
    `;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email],
        subject: "Seu pedido na Kiroshi Opticals",
        html,
      }),
    });

    const data = await r.json();
    return new Response(JSON.stringify(data), {
      status: r.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
