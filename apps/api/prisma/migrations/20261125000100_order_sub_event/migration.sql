-- The kind of event within its type (Associate, Annual Day, Engagement, Exports, IT ...); optional.
ALTER TABLE "orders" ADD COLUMN "sub_event" VARCHAR(40);
