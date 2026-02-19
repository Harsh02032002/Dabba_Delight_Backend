import MarketingCampaign from "./marketingCampaign.model.js";

// Lightweight in-memory queue fallback when a real queue (Bull/bee-queue) isn't configured.
const marketingQueue = (() => {
  let processor = null;
  const pending = [];
  return {
    add: async (name, data, opts = {}) => {
      const job = { name, data, opts };
      if (processor) {
        const delay = opts.delay || 0;
        setTimeout(() => processor(job), delay);
      } else {
        pending.push(job);
      }
      return job;
    },
    process: (name, fn) => {
      processor = async (job) => {
        try {
          await fn(job);
        } catch (err) {
          console.error("marketingQueue job failed", err);
        }
      };
      // drain pending jobs
      while (pending.length) {
        const j = pending.shift();
        const delay = j.opts?.delay || 0;
        setTimeout(() => processor(j), delay);
      }
    },
  };
})();

// Get Campaigns
export const getCampaigns = async (req, res) => {
  try {
    const campaigns = await MarketingCampaign.find({ sellerId: req.user._id });
    res.json(campaigns);
  } catch (err) {
    sendError(res, 500, "Campaigns fetch failed", err);
  }
};

// Create/Schedule Campaign
export const createCampaign = async (req, res) => {
  try {
    const campaign = await MarketingCampaign.create({
      ...req.body,
      sellerId: req.user._id,
    });
    // Queue job
    await marketingQueue.add(
      "sendCampaign",
      { campaignId: campaign._id },
      { delay: campaign.scheduledAt - Date.now() },
    );
    res.status(201).json(campaign);
  } catch (err) {
    sendError(res, 400, "Campaign creation failed", err);
  }
};

// Process Queue (in separate worker file or app.js)
marketingQueue.process("sendCampaign", async (job) => {
  const campaign = await MarketingCampaign.findById(job.data.campaignId);
  if (!campaign) return console.warn("Campaign not found", job.data.campaignId);
  // TODO: integrate email/SMS utils here to send the campaign
  console.log(`Sending campaign: ${campaign.title}`);
  campaign.status = "sent";
  await campaign.save();
});
