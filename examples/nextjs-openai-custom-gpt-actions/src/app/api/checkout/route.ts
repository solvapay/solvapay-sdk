import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const plan = url.searchParams.get('plan') || 'pro';
  const returnUrl = url.searchParams.get('return_url') || '';
  const userId = url.searchParams.get('user_id') || 'user_1';

  const planDetails = {
    pro: { name: 'PRO Plan', price: '$29/month', features: ['Unlimited API calls', 'Priority support', 'Advanced analytics', 'Custom integrations', '24/7 monitoring'] },
    enterprise: { name: 'ENTERPRISE Plan', price: '$99/month', features: ['Everything in PRO', 'Dedicated support', 'Custom integrations', 'SLA guarantees', 'On-premise deployment'] }
  };

  const selectedPlan = planDetails[plan as keyof typeof planDetails] || planDetails.pro;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Upgrade Your Plan</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .plan-card { border: 2px solid #007cba; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .plan-name { font-size: 24px; font-weight: bold; color: #007cba; margin-bottom: 10px; }
        .plan-price { font-size: 32px; font-weight: bold; margin-bottom: 15px; }
        .features { list-style: none; padding: 0; }
        .features li { padding: 5px 0; }
        .features li:before { content: "✓ "; color: #28a745; font-weight: bold; }
        .upgrade-btn { background: #28a745; color: white; padding: 15px 30px; border: none; border-radius: 5px; font-size: 18px; cursor: pointer; text-decoration: none; display: inline-block; margin: 10px; }
        .upgrade-btn:hover { background: #218838; }
        .demo-note { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 15px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <h1>Upgrade Your Plan</h1>
      
      <div class="plan-card">
        <div class="plan-name">${selectedPlan.name}</div>
        <div class="plan-price">${selectedPlan.price}</div>
        <ul class="features">
          ${selectedPlan.features.map(feature => `<li>${feature}</li>`).join('')}
        </ul>
      </div>
      
      <div class="demo-note">
        <strong>Demo Mode:</strong> This is a demonstration checkout page. 
        In a real implementation, this would integrate with your payment processor.
      </div>
      
      <div style="text-align: center; margin-top: 30px;">
        <a href="/api/checkout/payment?plan=${plan}&return_url=${returnUrl}&user_id=${userId}" class="upgrade-btn">Upgrade Now</a>
      </div>
    </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}
