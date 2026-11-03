declare module "web-push" {
  type PushSubscription = {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };

  type WebPush = {
    generateVAPIDKeys(): { publicKey: string; privateKey: string };
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(
      subscription: PushSubscription,
      payload: string,
      options?: { urgency?: "very-low" | "low" | "normal" | "high"; TTL?: number },
    ): Promise<unknown>;
  };

  const webpush: WebPush;
  export default webpush;
}