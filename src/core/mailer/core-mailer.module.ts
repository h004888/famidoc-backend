import { Global, Module } from '@nestjs/common';
import { CoreMailerService } from './core-mailer.service';

@Global()
@Module({
  providers: [
    CoreMailerService,
    {
      provide: 'MAILER_SERVICE',
      useExisting: CoreMailerService,
    },
  ],
  exports: [CoreMailerService, 'MAILER_SERVICE'],
})
export class CoreMailerModule {}
